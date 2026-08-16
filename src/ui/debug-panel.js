import './debug-panel.css';
import { getLyricsPreferences, updateLyricsPreference } from '../lyrics/preferences.js';
import { emit } from '@tauri-apps/api/event';

// 主窗口播放器动作经事件桥转发（独立调试窗口无 player 对象）
const playerAction = (action, value) => {
  emit('debug-action', { action, value }).catch(() => {});
};

function fmtTime(seconds) {
  if (seconds == null || Number.isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TAB_CONFIG = [
  { id: 'playback', label: '🎵 播放器' },
  { id: 'lyrics', label: '📝 歌词' },
  { id: 'appearance', label: '🎨 外观' },
  { id: 'prefs', label: '⚙️ 偏好' },
  { id: 'actions', label: '🧰 操作' },
  { id: 'log', label: '📋 日志' },
];

let panelEl = null;
let triggerEl = null; // 已弃用（触发器按钮移除），保留引用以防外部访问
let isOpen = false;
let updateRafId = null;
let fpsFrames = 0;
let fpsLastTime = performance.now();
let currentFps = 0;
const logBuffer = [];
const MAX_LOGS = 200;

// ── Console capture ──
function captureConsole() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;

  const wrap = (type, orig) => (...args) => {
    orig.apply(console, args);
    const text = args.map(a => {
      try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      } catch { return String(a); }
    }).join(' ');
    addLogEntry(type, text);
  };

  console.log = wrap('log', origLog);
  console.warn = wrap('warn', origWarn);
  console.error = wrap('error', origError);
  console.info = wrap('info', origInfo);

  window.addEventListener('error', (e) => {
    addLogEntry('error', `${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    addLogEntry('error', `Unhandled Promise: ${e.reason}`);
  });
}

function addLogEntry(type, text) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logBuffer.push({ type, text, time });
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  renderLogs();
}

function renderLogs() {
  const logEl = panelEl?.querySelector('.debug-log-panel');
  if (!logEl) return;
  logEl.innerHTML = logBuffer.map(l =>
    `<div class="debug-log-entry ${l.type}"><span class="debug-log-time">${l.time}</span>${escapeHtml(l.text)}</div>`
  ).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Panel HTML building ──
function buildPanel() {
  const el = document.createElement('div');
  el.id = 'dev-debug-panel';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="debug-header">
      <div class="debug-header-title">
        <span class="debug-icon">🔧</span>
        <span>开发者调试</span>
        <span class="debug-fps" id="debug-fps">-- FPS</span>
      </div>
      <button class="debug-close-btn" id="debug-close">✕</button>
    </div>
    <div class="debug-tabs">
      ${TAB_CONFIG.map((t, i) =>
        `<button class="debug-tab ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`
      ).join('')}
    </div>
    <div class="debug-content">
      ${buildPlaybackTab()}
      ${buildLyricsTab()}
      ${buildAppearanceTab()}
      ${buildPrefsTab()}
      ${buildActionsTab()}
      ${buildLogTab()}
    </div>
  `;
  return el;
}

function buildPlaybackTab() {
  return `
    <div class="debug-tab-panel active" data-panel="playback">
      <div class="debug-section">
        <div class="debug-section-title">播放状态</div>
        <div class="debug-info-grid">
          <span class="debug-info-label">状态</span>
          <span class="debug-info-value accent" id="dbg-play-state">--</span>
          <span class="debug-info-label">当前时间</span>
          <span class="debug-info-value" id="dbg-current-time">0:00</span>
          <span class="debug-info-label">总时长</span>
          <span class="debug-info-value" id="dbg-duration">0:00</span>
          <span class="debug-info-label">进度</span>
          <span class="debug-info-value" id="dbg-progress">0%</span>
          <span class="debug-info-label">音量</span>
          <span class="debug-info-value" id="dbg-volume">--</span>
          <span class="debug-info-label">播放速度</span>
          <span class="debug-info-value" id="dbg-rate">1.0x</span>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">进度控制</div>
        <div class="debug-time-display">
          <span class="current" id="dbg-seek-cur">0:00</span>
          <span id="dbg-seek-dur">0:00</span>
        </div>
        <input type="range" class="debug-slider debug-seek-bar" id="dbg-seek" min="0" max="1000" value="0" step="1">
      </div>
      <div class="debug-section">
        <div class="debug-section-title">播放速度</div>
        <div class="debug-speed-row" id="dbg-speed-btns">
          ${[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(s =>
            `<button class="debug-speed-btn ${s === 1.0 ? 'active' : ''}" data-rate="${s}">${s}x</button>`
          ).join('')}
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">播放控制</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" id="dbg-play-pause">⏸ 暂停</button>
          <button class="debug-btn" id="dbg-prev">⏮ 上一首</button>
          <button class="debug-btn" id="dbg-next">⏭ 下一首</button>
          <button class="debug-btn" id="dbg-reload">🔄 重载音频</button>
        </div>
      </div>
    </div>
  `;
}

function buildLyricsTab() {
  return `
    <div class="debug-tab-panel" data-panel="lyrics">
      <div class="debug-section">
        <div class="debug-section-title">歌词状态</div>
        <div class="debug-info-grid">
          <span class="debug-info-label">总行数</span>
          <span class="debug-info-value" id="dbg-line-count">0</span>
          <span class="debug-info-label">激活行</span>
          <span class="debug-info-value accent" id="dbg-active-idx">-1</span>
          <span class="debug-info-label">滚动索引</span>
          <span class="debug-info-value" id="dbg-scroll-idx">-1</span>
          <span class="debug-info-label">自动滚动</span>
          <span class="debug-info-value" id="dbg-auto-scroll">--</span>
          <span class="debug-info-label">用户滚动</span>
          <span class="debug-info-value" id="dbg-user-scroll">--</span>
          <span class="debug-info-label">当前字进度</span>
          <span class="debug-info-value" id="dbg-word-progress">--</span>
          <span class="debug-info-label">DOM节点数</span>
          <span class="debug-info-value" id="dbg-dom-count">0</span>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">歌词偏移 (ms)</div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>时间偏移</span>
            <span id="dbg-offset-val">0ms</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-offset" min="-2000" max="2000" value="0" step="50">
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">歌词操作</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" id="dbg-force-render">🔄 强制重渲染</button>
          <button class="debug-btn" id="dbg-realign">📐 重新对齐</button>
          <button class="debug-btn" id="dbg-reset-cache">🗑 清除缓存</button>
          <button class="debug-btn" id="dbg-view-full">📄 完整歌词</button>
        </div>
      </div>
    </div>
  `;
}

function buildAppearanceTab() {
  return `
    <div class="debug-tab-panel" data-panel="appearance">
    
      <div class="debug-section">
        <div class="debug-section-title">视觉调试开关</div>
        <div class="debug-toggle-row">
          <span>显示包围盒 (bbox)</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-bboxes">
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>禁用所有动画</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-no-anim">
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>禁用景深模糊</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-no-blur">
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>显示字抬升值</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-show-lift">
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>显示FPS</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-show-fps" checked>
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>性能模式</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-perf-mode">
            <span class="debug-switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="debug-section">
        <div class="debug-section-title">主题模式</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" data-theme="dark">🌙 深色</button>
          <button class="debug-btn" data-theme="light">☀️ 浅色</button>
          <button class="debug-btn" data-theme="gray">🩶 灰色</button>
          <button class="debug-btn" data-theme="black">⬛ 纯黑</button>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">UI 材质</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" data-uistyle="acrylic">🧊 亚克力</button>
          <button class="debug-btn" data-uistyle="gaussian">🌫 高斯</button>
          <button class="debug-btn" data-uistyle="liquid">💧 液体</button>
          <button class="debug-btn" data-uistyle="solid">⬜ 纯色</button>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">背景样式</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" data-bgstyle="static">🖼 静态</button>
          <button class="debug-btn" data-bgstyle="blur">💨 模糊</button>
          <button class="debug-btn" data-bgstyle="video">🎬 视频</button>
          <button class="debug-btn" data-bgstyle="none">❌ 无</button>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">UI 缩放</div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>缩放比例</span>
            <span id="dbg-scale-val">100%</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-scale" min="70" max="150" value="100" step="5">
        </div>
      </div>
    </div>
  `;
}

function buildPrefsTab() {
  const prefs = getLyricsPreferences();
  return `
    <div class="debug-tab-panel" data-panel="prefs">
      <div class="debug-section">
        <div class="debug-section-title">歌词偏好实时调节</div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>字号 (px)</span>
            <span id="dbg-fontsize-val">${prefs.fontSize || 22}px</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-fontsize" min="12" max="48" value="${prefs.fontSize || 22}" step="1">
        </div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>行间距</span>
            <span id="dbg-linespacing-val">${(prefs.lineSpacing ?? 0.85).toFixed(2)}</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-linespacing" min="0.2" max="2.0" value="${prefs.lineSpacing ?? 0.85}" step="0.05">
        </div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>滚动对齐位置</span>
            <span id="dbg-align-val">${Math.round((prefs.scrollAlign ?? 0.5) * 100)}%</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-align" min="0" max="100" value="${Math.round((prefs.scrollAlign ?? 0.5) * 100)}" step="5">
        </div>
        <div class="debug-slider-row">
          <div class="debug-slider-label">
            <span>字重</span>
            <span id="dbg-fontweight-val">${prefs.fontWeight || 600}</span>
          </div>
          <input type="range" class="debug-slider" id="dbg-fontweight" min="300" max="900" value="${prefs.fontWeight || 600}" step="100">
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">切换开关</div>
        <div class="debug-toggle-row">
          <span>注音在下方</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-ruby-below" ${prefs.rubyPosition === 'below' ? 'checked' : ''}>
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>行跟随</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-row-follow" ${prefs.rowFollowEnabled !== false ? 'checked' : ''}>
            <span class="debug-switch-slider"></span>
          </label>
        </div>
        <div class="debug-toggle-row">
          <span>信息过滤</span>
          <label class="debug-switch">
            <input type="checkbox" id="dbg-info-filter" ${prefs.filterInfoEnabled === true ? 'checked' : ''}>
            <span class="debug-switch-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

function buildActionsTab() {
  return `
    <div class="debug-tab-panel" data-panel="actions">
      <div class="debug-section">
        <div class="debug-section-title">窗口与调试</div>
        <div class="debug-btn-grid">
          <button class="debug-btn accent" id="dbg-devtools">🔍 开发者工具</button>
          <button class="debug-btn" id="dbg-immersive">🌌 沉浸模式</button>
          <button class="debug-btn" id="dbg-desktop-lyrics">💻 桌面歌词</button>
          <button class="debug-btn" id="dbg-fullscreen">⛶ 全屏</button>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">应用操作</div>
        <div class="debug-btn-grid">
          <button class="debug-btn" id="dbg-reload-page">🔃 刷新页面</button>
          <button class="debug-btn danger" id="dbg-clear-storage">🗑 清除存储</button>
          <button class="debug-btn full-width" id="dbg-export-logs">📤 导出日志</button>
        </div>
      </div>
      <div class="debug-section">
        <div class="debug-section-title">歌词编辑</div>
        <div class="debug-btn-grid">
          <button class="debug-btn full-width" id="dbg-open-editor">✏️ 打开歌词编辑器</button>
        </div>
      </div>
    </div>
  `;
}

function buildLogTab() {
  return `
    <div class="debug-tab-panel" data-panel="log">
      <div class="debug-section">
        <div class="debug-section-title">控制台日志</div>
        <div class="debug-btn-grid" style="margin-bottom:8px;">
          <button class="debug-btn" id="dbg-clear-logs">🗑 清空日志</button>
          <button class="debug-btn" id="dbg-copy-logs">📋 复制日志</button>
        </div>
        <div class="debug-log-panel" id="debug-log-container"></div>
      </div>
    </div>
  `;
}

// ── Dragging ──
function makeDraggable(el) {
  const header = el.querySelector('.debug-header');
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.debug-close-btn')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    el.style.right = 'auto';
    el.style.left = `${startLeft}px`;
    el.style.top = `${startTop}px`;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - el.offsetHeight, startTop + dy))}px`;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ── Data update loop ──
function updateLoop(player) {
  if (!isOpen || !panelEl) {
    updateRafId = requestAnimationFrame(() => updateLoop(player));
    return;
  }

  // FPS calculation
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastTime >= 1000) {
    currentFps = Math.round((fpsFrames * 1000) / (now - fpsLastTime));
    fpsFrames = 0;
    fpsLastTime = now;
    const fpsEl = panelEl.querySelector('#debug-fps');
    if (fpsEl) {
      fpsEl.textContent = `${currentFps} FPS`;
      fpsEl.style.color = currentFps >= 55 ? '#10b981' : currentFps >= 30 ? '#f59e0b' : '#f87171';
    }
  }
  // 独立调试窗口无主窗口 player：播放状态段仅在主窗口模式下更新
  const audio = player?.audio;
  if (audio) {
    const dur = isFinite(audio.duration) ? audio.duration : 0;

    // Playback info
    setText('#dbg-play-state', player.isPlaying ? '▶ 播放中' : '⏸ 暂停');
    setText('#dbg-current-time', fmtTime(audio.currentTime));
    setText('#dbg-duration', fmtTime(dur));
    setText('#dbg-progress', dur > 0 ? `${((audio.currentTime / dur) * 100).toFixed(1)}%` : '--');
    setText('#dbg-volume', `${Math.round((audio.volume || 0) * 100)}%`);
    setText('#dbg-rate', `${audio.playbackRate || 1.0}x`);

    // Seek bar
    const seekEl = panelEl.querySelector('#dbg-seek');
    if (seekEl && document.activeElement !== seekEl) {
      seekEl.value = dur > 0 ? Math.round((audio.currentTime / dur) * 1000) : 0;
    }
    setText('#dbg-seek-cur', fmtTime(audio.currentTime));
    setText('#dbg-seek-dur', fmtTime(dur));
  }

  // Lyrics info（独立窗口无主窗口 DOM/lyrics 对象，跳过）
  const lyrics = player?.lyrics;
  if (lyrics) {
    setText('#dbg-line-count', lyrics.lines ? lyrics.lines.length : 0);
    setText('#dbg-active-idx', lyrics.activeIndex);
    setText('#dbg-scroll-idx', lyrics.currentScrollIndex);
    setText('#dbg-auto-scroll', lyrics.isAutoScrolling ? '是' : '否');
    setText('#dbg-user-scroll', lyrics.isUserScrolling ? '是' : '否');
    const domLines = document.querySelectorAll('#lyrics-lines .lyrics-line');
    const domWords = document.querySelectorAll('.lyrics-word');
    setText('#dbg-dom-count', `${domLines.length}行 / ${domWords.length}字`);

    // Active word progress
    if (lyrics.activeIndex >= 0 && domLines[lyrics.activeIndex]) {
      const activeWord = domLines[lyrics.activeIndex].querySelector('.lyrics-word[data-fill-val]');
      if (activeWord) {
        const fill = parseFloat(activeWord.dataset.fillVal || 0);
        setText('#dbg-word-progress', `${(fill * 100).toFixed(0)}%`);
      } else {
        setText('#dbg-word-progress', '--');
      }
    } else {
      setText('#dbg-word-progress', '--');
    }
  }

  updateRafId = requestAnimationFrame(() => updateLoop(player));
}

function setText(sel, text) {
  const el = panelEl?.querySelector(sel);
  if (el && el.textContent !== String(text)) el.textContent = text;
}

// ── Event binding ──
function bindEvents(player) {
  const audio = player?.audio;
  const lyrics = player?.lyrics;

  // Close：独立窗口直接关闭窗口；主窗口模式隐藏面板
  panelEl.querySelector('#debug-close').addEventListener('click', () => {
    if (document.body.hasAttribute('data-debug-window')) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close());
    } else {
      closePanel();
    }
  });

  // Tabs
  panelEl.querySelectorAll('.debug-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panelEl.querySelectorAll('.debug-tab').forEach(t => t.classList.remove('active'));
      panelEl.querySelectorAll('.debug-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      panelEl.querySelector(`.debug-tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      // 切换分类时内容区回到顶部，避免残留上一页的滚动位置
      const content = panelEl.querySelector('.debug-content');
      if (content) content.scrollTop = 0;
    });
  });

  // ── Playback controls（事件桥 → 主窗口）──
  panelEl.querySelector('#dbg-play-pause').addEventListener('click', () => {
    if (audio) { if (audio.paused) audio.play(); else audio.pause(); }
    else playerAction('play-pause');
  });

  panelEl.querySelector('#dbg-prev').addEventListener('click', () => {
    if (typeof player?.previous === 'function') player.previous();
    else playerAction('prev');
  });
  panelEl.querySelector('#dbg-next').addEventListener('click', () => {
    if (typeof player?.next === 'function') player.next();
    else playerAction('next');
  });
  panelEl.querySelector('#dbg-reload').addEventListener('click', () => {
    if (audio?.src) {
      const t = audio.currentTime;
      audio.load();
      audio.currentTime = t;
    } else {
      playerAction('reload-audio');
    }
  });

  // Seek
  const seekEl = panelEl.querySelector('#dbg-seek');
  seekEl.addEventListener('input', () => {
    if (audio && durSafe(audio)) {
      audio.currentTime = (parseFloat(seekEl.value) / 1000) * audio.duration;
    } else {
      playerAction('seek', parseFloat(seekEl.value));
    }
  });

  // Speed
  panelEl.querySelectorAll('.debug-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate);
      if (audio) audio.playbackRate = rate;
      else playerAction('speed', rate);
      panelEl.querySelectorAll('.debug-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Lyrics controls（事件桥 → 主窗口）──
  panelEl.querySelector('#dbg-force-render').addEventListener('click', () => {
    if (lyrics) {
      lyrics.resetAlignmentCache();
      lyrics.render?.();
    } else {
      playerAction('force-render');
    }
  });
  panelEl.querySelector('#dbg-realign').addEventListener('click', () => {
    if (lyrics) lyrics.realign?.();
    else playerAction('realign');
  });
  panelEl.querySelector('#dbg-reset-cache').addEventListener('click', () => {
    try {
      const dbs = ['kimo-lyrics-cache', 'kimo-lyrics-blob-cache', 'kimo-audio-blob-cache'];
      dbs.forEach(n => {
        try { indexedDB.deleteDatabase(n); } catch {}
      });
      addLogEntry('info', '缓存数据库已清除，请刷新页面');
    } catch (e) { addLogEntry('error', `清除缓存失败: ${e}`); }
  });
  panelEl.querySelector('#dbg-view-full').addEventListener('click', () => {
    if (lyrics) lyrics.viewFullLyrics?.();
    else playerAction('view-full');
  });

  // Offset slider
  const offsetEl = panelEl.querySelector('#dbg-offset');
  offsetEl.value = getLyricsPreferences().timeOffset || 0;
  panelEl.querySelector('#dbg-offset-val').textContent = `${offsetEl.value}ms`;
  offsetEl.addEventListener('input', () => {
    const val = parseInt(offsetEl.value);
    updateLyricsPreference('timeOffset', val);
    panelEl.querySelector('#dbg-offset-val').textContent = `${val}ms`;
  });

  // ── Visual toggles（独立窗口转发到主窗口 body）──
  const toggleBodyClass = (id, cls) => {
    panelEl.querySelector(id).addEventListener('change', (e) => {
      if (document.body.hasAttribute('data-debug-window')) {
        playerAction('toggle-class', { cls, on: e.target.checked });
      } else {
        document.body.classList.toggle(cls, e.target.checked);
      }
    });
  };
  toggleBodyClass('#dbg-bboxes', 'debug-show-bboxes');
  toggleBodyClass('#dbg-no-anim', 'debug-no-animations');
  toggleBodyClass('#dbg-show-lift', 'debug-show-lift');

  panelEl.querySelector('#dbg-no-blur').addEventListener('change', (e) => {
    if (lyrics) lyrics.setBlurEnabled?.(!e.target.checked);
    else playerAction('toggle-class', { cls: 'debug-no-blur', on: e.target.checked });
  });
  panelEl.querySelector('#dbg-perf-mode').addEventListener('change', (e) => {
    localStorage.setItem('kimo-performance-mode', e.target.checked ? 'true' : 'false');
    if (document.body.hasAttribute('data-debug-window')) {
      playerAction('toggle-class', { cls: 'perf-mode', on: e.target.checked });
    } else {
      document.body.classList.toggle('perf-mode', e.target.checked);
    }
  });

  // ── Preference sliders ──
  const bindPrefSlider = (sel, valSel, key, transform, fmt) => {
    const el = panelEl.querySelector(sel);
    const valEl = panelEl.querySelector(valSel);
    if (!el) return;
    el.addEventListener('input', () => {
      const rawVal = parseFloat(el.value);
      const val = transform ? transform(rawVal) : rawVal;
      updateLyricsPreference(key, val);
      valEl.textContent = fmt ? fmt(val) : val;
    });
  };

  bindPrefSlider('#dbg-fontsize', '#dbg-fontsize-val', 'fontSize', null, v => `${v}px`);
  bindPrefSlider('#dbg-linespacing', '#dbg-linespacing-val', 'lineSpacing', null, v => v.toFixed(2));
  bindPrefSlider('#dbg-align', '#dbg-align-val', 'scrollAlign', v => v / 100, v => `${Math.round(v * 100)}%`);
  bindPrefSlider('#dbg-fontweight', '#dbg-fontweight-val', 'fontWeight', null, v => `${v}`);

  // Preference toggles
  panelEl.querySelector('#dbg-ruby-below').addEventListener('change', (e) => {
    updateLyricsPreference('rubyPosition', e.target.checked ? 'below' : 'above');
    const lyricsPanel = document.querySelector('.lyrics-panel');
    if (lyricsPanel) lyricsPanel.setAttribute('data-ruby-position', e.target.checked ? 'below' : 'above');
  });
  panelEl.querySelector('#dbg-row-follow').addEventListener('change', (e) => {
    updateLyricsPreference('rowFollowEnabled', e.target.checked);
  });
  panelEl.querySelector('#dbg-info-filter').addEventListener('change', (e) => {
    updateLyricsPreference('filterInfoEnabled', e.target.checked);
    lyrics?.resetAlignmentCache?.();
    lyrics?.render?.();
  });

  // ── Theme buttons ──
  const applyThemeBtn = (selector, attr, storageKey, fn) => {
    panelEl.querySelectorAll(selector).forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset[attr];
        localStorage.setItem(storageKey, val);
        fn?.(val);
        window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue: val }));
        location.reload();
      });
    });
  };
  applyThemeBtn('[data-theme]', 'theme', 'kimo-theme');
  applyThemeBtn('[data-uistyle]', 'uistyle', 'kimo-ui-style');
  applyThemeBtn('[data-bgstyle]', 'bgstyle', 'kimo-bg-style');

  // Scale slider
  const scaleEl = panelEl.querySelector('#dbg-scale');
  const scaleVal = panelEl.querySelector('#dbg-scale-val');
  const savedScale = parseFloat(localStorage.getItem('kimo-ui-scale')) || 1.0;
  scaleEl.value = Math.round(savedScale * 100);
  scaleVal.textContent = `${Math.round(savedScale * 100)}%`;
  scaleEl.addEventListener('input', () => {
    const v = parseInt(scaleEl.value) / 100;
    document.documentElement.style.setProperty('--ui-scale', v);
    document.documentElement.style.zoom = v;
    localStorage.setItem('kimo-ui-scale', v);
    scaleVal.textContent = `${Math.round(v * 100)}%`;
  });

  // ── Actions ──
  panelEl.querySelector('#dbg-devtools').addEventListener('click', async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // WebviewWindow doesn't directly expose openDevTools in all versions;
      // try via Tauri's webview API first
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const wv = getCurrentWebview();
        if (wv?.openDevTools) { wv.openDevTools(); return; }
      } catch {}
      // Fallback: use eval via invoke or postMessage if available
      addLogEntry('warn', 'DevTools API 不可用，请用右键菜单或 Ctrl+Shift+I');
    } catch (e) {
      addLogEntry('warn', 'DevTools API 不可用');
    }
  });

  panelEl.querySelector('#dbg-immersive').addEventListener('click', () => {
    const btn = document.getElementById('immersive-toggle') || document.querySelector('[data-action="immersive"]');
    if (btn) btn.click();
    else playerAction('immersive');
  });

  panelEl.querySelector('#dbg-desktop-lyrics').addEventListener('click', () => {
    const btn = document.getElementById('desktop-lyrics-toggle') || document.querySelector('[data-action="desktop-lyrics"]');
    if (btn) btn.click();
    else playerAction('desktop-lyrics');
  });

  panelEl.querySelector('#dbg-fullscreen').addEventListener('click', () => {
    if (document.body.hasAttribute('data-debug-window')) {
      playerAction('fullscreen');
      return;
    }
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  panelEl.querySelector('#dbg-reload-page').addEventListener('click', () => {
    if (document.body.hasAttribute('data-debug-window')) playerAction('reload-main');
    else location.reload();
  });
  panelEl.querySelector('#dbg-clear-storage').addEventListener('click', () => {
    if (confirm('确定要清除所有 localStorage 数据吗？这会重置所有设置。')) {
      localStorage.clear();
      location.reload();
    }
  });
  panelEl.querySelector('#dbg-export-logs').addEventListener('click', () => {
    const blob = new Blob([logBuffer.map(l => `[${l.time}] [${l.type}] ${l.text}`).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kimoPlayer-debug-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  });
  panelEl.querySelector('#dbg-open-editor').addEventListener('click', () => {
    if (typeof window.openMetadataEditor === 'function') {
      window.openMetadataEditor();
    } else {
      playerAction('open-editor');
    }
  });

  // ── Log tab ──
  panelEl.querySelector('#dbg-clear-logs').addEventListener('click', () => {
    logBuffer.length = 0;
    renderLogs();
  });
  panelEl.querySelector('#dbg-copy-logs').addEventListener('click', () => {
    const text = logBuffer.map(l => `[${l.time}] [${l.type}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      addLogEntry('info', '日志已复制到剪贴板');
    });
  });

  // Trigger button 已移除：开发者面板不再常驻（由主窗口 Ctrl+Shift+D 打开独立窗口）

  // Keyboard shortcut: Ctrl+Shift+D（独立窗口内忽略——窗口开关由主窗口管理）
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (document.body.hasAttribute('data-debug-window')) return;
      togglePanel();
    }
    if (e.key === 'Escape' && isOpen && !document.body.hasAttribute('data-debug-window')) {
      closePanel();
    }
  });
}

function durSafe(audio) {
  return audio.duration && isFinite(audio.duration) && audio.duration > 0;
}

// ── Open / Close ──
function openPanel() {
  if (!panelEl) return;
  panelEl.classList.remove('hidden');
  document.body.classList.add('debug-panel-open');
  isOpen = true;
}

function closePanel() {
  if (!panelEl) return;
  panelEl.classList.add('hidden');
  document.body.classList.remove('debug-panel-open');
  isOpen = false;
}

function togglePanel() {
  if (isOpen) closePanel(); else openPanel();
}

// ── Init ──
export function initDebugPanel(player) {
  if (panelEl) return; // already initialized

  captureConsole();

  panelEl = buildPanel();
  // 不再创建常驻触发器按钮：开发者面板默认不常驻，
  // 通过 Ctrl+Shift+D（主窗口快捷键）打开独立调试窗口

  document.body.appendChild(panelEl);

  if (document.body.hasAttribute('data-debug-window')) {
    openPanel(); // 独立窗口：初始化即全窗口显示
  } else {
    makeDraggable(panelEl);
  }
  bindEvents(player);

  // Start FPS/update loop
  updateLoop(player);

  // Expose for external access
  window.__debugPanel = {
    toggle: togglePanel,
    open: openPanel,
    close: closePanel,
    log: (type, msg) => addLogEntry(type || 'log', msg),
  };

  addLogEntry('info', '调试面板已初始化 (Ctrl+Shift+D 切换)');
}
