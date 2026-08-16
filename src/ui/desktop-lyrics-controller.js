import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { hideCommentsPanel } from '../features/comments-panel.js';
import { getStoredDesktopLyricsFont, getStoredInterfaceFont, resolveDesktopLyricsFontFamily } from './interface-font.js';

const THEME_PRESETS = ['follow-app', 'aurora', 'cyber', 'sunset', 'ocean', 'white'];

const getStyle = () => {
  const dynamicColor = document.documentElement.style.getPropertyValue('--dynamic-color-a') || '0, 180, 216';
  const fontObj = getStoredDesktopLyricsFont();
  return {
    fontSize: Number(localStorage.getItem('kimo-desktop-lyrics-font-size') || 34),
    opacity: Number(localStorage.getItem('kimo-desktop-lyrics-opacity') || 0.96),
    showTranslation: localStorage.getItem('kimo-desktop-lyrics-show-translation') !== 'false',
    locked: localStorage.getItem('kimo-desktop-lyrics-locked') === 'true',
    wordByWord: localStorage.getItem('kimo-desktop-lyrics-word-by-word') !== 'false',
    glow: localStorage.getItem('kimo-desktop-lyrics-glow') !== 'false',
    stroke: localStorage.getItem('kimo-desktop-lyrics-stroke') !== 'false',
    theme: localStorage.getItem('kimo-desktop-lyrics-theme') || 'follow-app',
    appTheme: localStorage.getItem('kimo-theme') || 'light',
    align: localStorage.getItem('kimo-desktop-lyrics-align') || 'left',
    lineMode: localStorage.getItem('kimo-desktop-lyrics-line-mode') || 'single',
    lineLayout: localStorage.getItem('kimo-desktop-lyrics-layout') || 'stacked',
    rubyPosition: localStorage.getItem('kimo-lyrics-ruby-position') || 'above',
    dynamicColor: dynamicColor.trim(),
    customColor: localStorage.getItem('kimo-desktop-lyrics-custom-color') === 'true',
    activeColor: localStorage.getItem('kimo-desktop-lyrics-color-active') || '',
    inactiveColor: localStorage.getItem('kimo-desktop-lyrics-color-inactive') || '',
    fontMode: fontObj.mode,
    // 用户字体路径：user 模式取自身；follow 模式下若界面字体是用户字体也一并传入，
    // 让桌面窗口注册 FontFace（否则 family 存在但窗口未注册会静默回退 system-ui）
    fontCustomPath: fontObj.mode.startsWith('user:')
      ? fontObj.mode.slice(5)
      : (fontObj.mode === 'follow'
        ? (getStoredInterfaceFont().mode.startsWith('user:') ? getStoredInterfaceFont().mode.slice(5) : fontObj.customPath)
        : fontObj.customPath),
    fontFamily: resolveDesktopLyricsFontFamily(fontObj.mode, fontObj.customPath),
  };
};

let _instance = null;

export function createDesktopLyricsController({ showToast, player }) {
  if (_instance) {
    if (player) _instance.setPlayer(player);
    return _instance;
  }
  let currentKey = '';
  let latestLine = null;
  let activePlayer = player || null;
  let lastSyncAt = 0;
  let lastSyncedText = '';
  let lastKaraokeAt = 0;
  let pendingVisible = null;
  let visibleChain = Promise.resolve(); // setVisible invoke 串行链（防首次创建竞态）
  let enabledCache = localStorage.getItem('kimo-desktop-lyrics-enabled') === 'true';
  const now = () => performance.now();
  const isEnabledCache = () => enabledCache;

  const setPlayer = (p) => {
    activePlayer = p;
  };

  const updateStyle = async () => {
    await emit('desktop-lyrics-style', getStyle()).catch(() => {});
  };

    const setVisible = async (visible, { silent = false } = {}) => {
      // 进行中防抖：同一目标的 invoke 未完成时不重复触发
      if (pendingVisible === visible) return;
      pendingVisible = visible;
      localStorage.setItem('kimo-desktop-lyrics-enabled', visible ? 'true' : 'false');
      enabledCache = visible; // 同步缓存，避免每帧读 localStorage
      emit('desktop-lyrics-visibility-changed', { visible }).catch(() => {});
      // 串行化：首次创建窗口的 invoke 可能耗时数百 ms，快速 开→关 若并发，
      // 关闭 invoke 会先到 Rust 侧（窗口未注册直接 Ok），随后创建完成弹出幽灵窗口
      visibleChain = visibleChain.then(async () => {
        await invoke('set_desktop_lyrics_visible', { visible });
        if (visible) {
          hideCommentsPanel();
          currentKey = '';
          await updateStyle();
          setTimeout(() => {
            if (latestLine) sync(latestLine);
          }, 240);
        }
        if (!silent) showToast(`桌面歌词已${visible ? '开启' : '关闭'}`);
      }).catch((error) => {
        console.error('[DesktopLyrics] Failed to change visibility:', error);
        if (!silent) showToast('桌面歌词操作失败');
      }).finally(() => {
        pendingVisible = null;
      });
      await visibleChain;
    };

  const sync = ({ text, translation, words, currentTime, lineStart, lineEnd, nextText, nextTranslation }) => {
    if (!isEnabledCache()) return;
    latestLine = { text, translation, words, currentTime, lineStart, lineEnd, nextText, nextTranslation };
    // 节流：桌面歌词更新最多 20fps（省 2/3 IPC）；暂停/停止时豁免，保证最后状态立即送达
    // 行切换（text 变化）也豁免：双行「两句一组」状态机依赖 update 先于 karaoke 到达（IPC 保序）
    const isPlaying = activePlayer ? !activePlayer.audio?.paused : false;
    const lineChanged = text !== lastSyncedText;
    if (isPlaying && !lineChanged && now() - lastSyncAt < 50) return;
    lastSyncedText = text;
    lastSyncAt = now();
    emit('desktop-lyrics-update', {
      text,
      translation,
      words,
      currentTime,
      lineStart,
      lineEnd,
      nextText,
      nextTranslation,
      isPlaying,
    }).catch(() => {});
  };

  const syncKaraokeProgress = ({ html, charC, totalChars, text, translation, nextText, nextTranslation }) => {
    if (!isEnabledCache()) return;
    // 节流：走字进度提升至 60fps 实时对齐迷你歌词
    const isPlaying = activePlayer ? !activePlayer.audio?.paused : false;
    if (isPlaying && now() - lastKaraokeAt < 16) return;
    lastKaraokeAt = now();
    emit('desktop-lyrics-karaoke', {
      html,
      charC,
      totalChars,
      text,
      translation,
      nextText,
      nextTranslation,
      isPlaying,
    }).catch(() => {});
  };

  const notifyPlaybackState = (isPlaying) => {
    emit('desktop-lyrics-playback-state', { isPlaying }).catch(() => {});
  };

  // 监听桌面窗口刚启动时的主动样式与状态拉取请求
  listen('desktop-lyrics-request-style', () => {
    updateStyle();
    if (latestLine) {
      sync(latestLine);
    } else {
      const isPlaying = activePlayer ? !activePlayer.audio?.paused : false;
      emit('desktop-lyrics-update', {
        text: 'KimoPlayer',
        style: getStyle(),
        isPlaying,
      }).catch(() => {});
    }
  });

  // 监听桌面歌词发送的交互控制指令
  listen('desktop-lyrics-action', (event) => {
    const { action } = event.payload || {};
    if (!action) return;

    switch (action) {
      case 'prev':
        if (activePlayer) activePlayer.prev?.();
        break;
      case 'toggle-play':
        if (activePlayer) activePlayer.toggle?.();
        break;
      case 'next':
        if (activePlayer) activePlayer.next?.();
        break;
      case 'cycle-theme': {
        const currentTheme = getStyle().theme;
        const currIndex = THEME_PRESETS.indexOf(currentTheme);
        const nextTheme = THEME_PRESETS[(currIndex + 1) % THEME_PRESETS.length];
        localStorage.setItem('kimo-desktop-lyrics-theme', nextTheme);
        updateStyle();
        showToast(`歌词主题: ${nextTheme}`);
        break;
      }
      case 'size-down': {
        const currSize = getStyle().fontSize;
        const newSize = Math.max(12, currSize - 2);
        localStorage.setItem('kimo-desktop-lyrics-font-size', String(newSize));
        // 同步更新主程序可能正开启着的设置滑块 UI
        const sizeSlider = document.getElementById('settings-desktop-lyrics-size');
        const sizeVal = document.getElementById('desktop-lyrics-size-val');
        if (sizeSlider) sizeSlider.value = newSize;
        if (sizeVal) sizeVal.textContent = `${newSize}px`;
        updateStyle();
        break;
      }
      case 'size-up': {
        const currSize = getStyle().fontSize;
        const newSize = Math.min(56, currSize + 2);
        localStorage.setItem('kimo-desktop-lyrics-font-size', String(newSize));
        // 同步更新主程序可能正开启着的设置滑块 UI
        const sizeSlider = document.getElementById('settings-desktop-lyrics-size');
        const sizeVal = document.getElementById('desktop-lyrics-size-val');
        if (sizeSlider) sizeSlider.value = newSize;
        if (sizeVal) sizeVal.textContent = `${newSize}px`;
        updateStyle();
        break;
      }
      case 'set-font-size': {
        const { size } = event.payload || {};
        if (typeof size === 'number') {
          const newSize = Math.max(12, Math.min(56, size));
          localStorage.setItem('kimo-desktop-lyrics-font-size', String(newSize));
          // 精准同步主程序可能正开启着的设置滑块与数值数值
          const sizeSlider = document.getElementById('settings-desktop-lyrics-size');
          const sizeVal = document.getElementById('desktop-lyrics-size-val');
          if (sizeSlider) sizeSlider.value = newSize;
          if (sizeVal) sizeVal.textContent = `${newSize}px`;
          updateStyle();
        }
        break;
      }
      case 'toggle-lock': {
        const locked = !getStyle().locked;
        localStorage.setItem('kimo-desktop-lyrics-locked', locked ? 'true' : 'false');
        updateStyle();
        showToast(`桌面歌词已${locked ? '锁定(穿透)' : '解锁'}`);
        break;
      }
      case 'toggle-line-mode': {
        const curMode = localStorage.getItem('kimo-desktop-lyrics-line-mode') || 'single';
        const nextMode = curMode === 'double' ? 'single' : 'double';
        localStorage.setItem('kimo-desktop-lyrics-line-mode', nextMode);
        const lineModeGroup = document.getElementById('settings-desktop-lyrics-line-mode-group');
        if (lineModeGroup) {
          lineModeGroup.setAttribute('data-active-idx', nextMode === 'double' ? '1' : '0');
          lineModeGroup.querySelectorAll('.setting-radio-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === nextMode);
          });
        }
        updateStyle();
        showToast(`桌面歌词已切换至: ${nextMode === 'double' ? '双行模式' : '单行模式'}`);
        break;
      }
      case 'close':
        setVisible(false);
        break;
    }
  });

  _instance = { getStyle, setVisible, sync, syncKaraokeProgress, updateStyle, setPlayer, notifyPlaybackState };
  return _instance;
}
