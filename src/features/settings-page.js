import {
  applyInterfaceFont,
  getFontFileName,
  getFontOptions,
  getUserFonts,
  addUserFont,
  removeUserFont,
  getStoredInterfaceFont,
  INTERFACE_FONT_PRESETS,
  getStoredLyricsFont,
  applyLyricsFont,
  getStoredDesktopLyricsFont,
  resolveDesktopLyricsFontFamily,
  DOWNLOADABLE_FONTS,
  downloadFont,
} from '../ui/interface-font.js';
import { checkForUpdates, setBetaKey, getBetaStatus, BETA_KEY, APP_VERSION } from '../ui/update-checker.js';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { updateLyricsPreference } from '../lyrics/preferences.js';
import { applyWindowMaterial, applyWindowOpacity } from '../ui/theme.js';
import { pruneLyricsCache } from '../storage/lyrics-cache-db.js';

function toggleSettingRow(row, show) {
  if (!row) return;
  if (show) {
    if (row.style.display === 'none') {
      row.classList.add('hidden-row');
    }
    row.style.display = 'flex';
    row.offsetHeight;
    row.classList.remove('hidden-row');
  } else {
    row.classList.add('hidden-row');
    setTimeout(() => {
      if (row.classList.contains('hidden-row')) {
        row.style.display = 'none';
      }
    }, 300);
  }
}

export const createSettingsPage = ({
  player,
  showToast,
  applyMiniLyricsTranslationSetting,
  applyTheme,
  applyLyricsTheme,
  applyUiStyle,
  applyBackgroundStyle,
  getCurrentTheme,
  customConfirm,
  clearLyricsDB,
  open,
  invoke,
  setMusicLibrary,
  clearSearchCache,
  resetDiscoverRecommendations,
  backgroundLoadCovers,
  desktopLyrics,
  switchTab,
  reapplyCurrentColor,
}) => {
  const renderSettingsTab = () => {
    const listEl = document.getElementById('music-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    // 清空工具栏，避免从其他 tab（搜索/局域网）切换过来时残留其工具栏内容；
    // 同时重置 className（luna 页会设置 luna-toolbar 类，需还原为 content-toolbar）
    const toolbarEl = document.getElementById('content-toolbar');
    if (toolbarEl) {
      toolbarEl.innerHTML = '';
      toolbarEl.className = 'content-toolbar';
    }

    const staggerMode = localStorage.getItem('kimo-lyrics-stagger-mode') || 'word';
    const fsRaw = localStorage.getItem('kimo-lyrics-font-size');
    const fontSize = (fsRaw !== null && !isNaN(parseFloat(fsRaw))) ? parseFloat(fsRaw) : 22.0;
    const liftRaw = localStorage.getItem('kimo-lyrics-lift-amplitude');
    const liftAmp = Math.max(
      0,
      Math.min(5, (liftRaw !== null && !isNaN(parseFloat(liftRaw))) ? parseFloat(liftRaw) : 4.0),
    );
    const lineSpacingRaw = localStorage.getItem('kimo-lyrics-line-spacing');
    const lineSpacing = (lineSpacingRaw !== null && !isNaN(parseFloat(lineSpacingRaw))) ? parseFloat(lineSpacingRaw) : 0.85;
    const rowFollowAnimationVal = localStorage.getItem('kimo-lyrics-row-follow-enabled') !== 'false';
    const filterLyricInfoVal = localStorage.getItem('kimo-lyrics-filter-info-enabled') === 'true';
    const miniTransVal = localStorage.getItem('kimo-mini-lyrics-show-translation') === 'true';
    const miniLyricsFontSize = Math.max(11, Math.min(18, Number(localStorage.getItem('kimo-mini-lyrics-font-size') || 13.5)));
    const desktopLyricsEnabled = localStorage.getItem('kimo-desktop-lyrics-enabled') === 'true';
    const desktopLyricsFontSize = Number(localStorage.getItem('kimo-desktop-lyrics-font-size') || 34);
    const desktopLyricsOpacity = Number(localStorage.getItem('kimo-desktop-lyrics-opacity') || 0.96);
    const desktopLyricsShowTranslation = localStorage.getItem('kimo-desktop-lyrics-show-translation') !== 'false';
    const desktopLyricsLocked = localStorage.getItem('kimo-desktop-lyrics-locked') === 'true';
    const desktopLyricsTheme = localStorage.getItem('kimo-desktop-lyrics-theme') || 'aurora';
    const desktopLyricsAlign = localStorage.getItem('kimo-desktop-lyrics-align') || 'left';
    const desktopLyricsWordByWord = localStorage.getItem('kimo-desktop-lyrics-word-by-word') !== 'false';
    const desktopLyricsGlow = localStorage.getItem('kimo-desktop-lyrics-glow') !== 'false';
    const desktopLyricsStroke = localStorage.getItem('kimo-desktop-lyrics-stroke') !== 'false';
    const desktopLyricsCustomColor = localStorage.getItem('kimo-desktop-lyrics-custom-color') === 'true';
    const desktopLyricsActiveColor = localStorage.getItem('kimo-desktop-lyrics-color-active') || '';
    const desktopLyricsInactiveColor = localStorage.getItem('kimo-desktop-lyrics-color-inactive') || '';
    const desktopLyricsLineMode = localStorage.getItem('kimo-desktop-lyrics-line-mode') || 'single';
    const desktopLyricsLayout = localStorage.getItem('kimo-desktop-lyrics-layout') || 'stacked';
    const songPlayMode = localStorage.getItem('kimo-song-play-mode') || 'single';
    const aiServerUrl = localStorage.getItem('kimo-ai-server-url') || 'http://127.0.0.1:8000';
        const showQualityBadgeVal = localStorage.getItem('kimo-show-quality-badge') !== 'false';
    const showBitrateBadgeVal = localStorage.getItem('kimo-show-bitrate-badge') !== 'false';
    const lyricsThemeVal = localStorage.getItem('kimo-lyrics-theme') || 'follow';
    
    let scannedDirs = [];
    try {
      scannedDirs = JSON.parse(localStorage.getItem('kimo-scanned-dirs') || '[]');
    } catch(e) {}

    const container = document.createElement('div');
    container.className = 'settings-container';

    // 🔍 永久置顶搜索栏
    const searchHeader = document.createElement('div');
    searchHeader.className = 'settings-search-sticky-header';
    searchHeader.innerHTML = `
      <div class="settings-search-box">
        <svg class="settings-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="settings-search-input" class="settings-search-input" placeholder="搜索设置项 (例如：歌词、主题、桌面歌词、取色、缩放)..." autocomplete="off" />
        <button id="settings-search-clear" class="settings-search-clear" title="清空搜索" style="display: none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="settings-search-result-count" class="settings-search-count" style="display: none;"></div>
    `;
    // 参考搜索页/本地音乐页：搜索头放到固定工具栏（content-toolbar），
    // 列表在其下方的独立滚动区域，结构上不会从搜索头下穿过
    const settingsToolbar = document.getElementById('content-toolbar');
    (settingsToolbar || container).appendChild(searchHeader);

    const noResultsEl = document.createElement('div');
    noResultsEl.id = 'settings-no-results';
    noResultsEl.className = 'settings-no-results';
    noResultsEl.style.display = 'none';
    noResultsEl.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      <span>未找到与“<strong id="settings-no-results-keyword"></strong>”匹配的设置项目</span>
    `;

    // ════════════════════════════════════════════════
    // 1. 🎨 外观与界面 (Appearance & Layout)
    // ════════════════════════════════════════════════
    const themeCard = document.createElement('div');
    themeCard.className = 'settings-card';
    const themeVal = localStorage.getItem('kimo-theme') || 'light';
    const uiStyleVal = localStorage.getItem('kimo-ui-style') || 'solid';
    const bgStyleVal = localStorage.getItem('kimo-bg-style') || 'static';
    const bgCustomPath = localStorage.getItem('kimo-custom-bg-path') || '';
    const bgCustomName = bgCustomPath ? bgCustomPath.split(/[\\/]/).pop() : '';
    const windowMaterialVal = localStorage.getItem('kimo-window-material') || 'none';
    const materialEnginePreview = localStorage.getItem('kimo-material-engine-preview') === 'true';
    // 迁移旧设置：此前「背景透明度」存于 kimo-bg-custom-opacity（0-1 格式），
    // 迁移为整窗口透明度（0-100 格式，需 ×100；<0.1 视为测试残留，重置为 100 防卡死）
    if (localStorage.getItem('kimo-window-opacity') === null && localStorage.getItem('kimo-bg-custom-opacity') !== null) {
      const oldVal = parseFloat(localStorage.getItem('kimo-bg-custom-opacity'));
      const migrated = Number.isFinite(oldVal) && oldVal >= 0.1 ? Math.round(oldVal * 100) : 100;
      localStorage.setItem('kimo-window-opacity', String(migrated));
      localStorage.removeItem('kimo-bg-custom-opacity');
    }
    const rawWindowOpacity = localStorage.getItem('kimo-window-opacity');
    const bgCustomOpacityPct = rawWindowOpacity !== null && Number.isFinite(parseFloat(rawWindowOpacity))
      ? Math.max(5, Math.round(parseFloat(rawWindowOpacity)))
      : 100;
    const bgMaskEnabled = localStorage.getItem('kimo-bg-mask-enabled') === 'true';
    const bgRotatePct = parseFloat(localStorage.getItem('kimo-bg-rotate-speed')) || 50;
    const isCustom = localStorage.getItem('kimo-overlay-opacity-custom') === 'true';
    const savedOpVal = isCustom ? localStorage.getItem('kimo-overlay-opacity') : null;
    const opacityNum = savedOpVal !== null ? Math.round(parseFloat(savedOpVal) * 100) : (themeVal === 'light' ? 72 : (themeVal === 'grey' ? 65 : 62));

    const zoomRaw = localStorage.getItem('kimo-ui-scale');
    const currentZoom = (zoomRaw !== null && !isNaN(parseFloat(zoomRaw))) ? parseFloat(zoomRaw) : 1.0;
    const zoomPercent = Math.round(currentZoom * 100);

    const interfaceFont = getStoredInterfaceFont();
    const interfaceFontOptions = getFontOptions().map(opt =>
      `<option value="${opt.value}" ${interfaceFont.mode === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');

    const storedLyricsFont = getStoredLyricsFont();
    const lyricsFontOptions = getFontOptions(true).map(opt =>
      `<option value="${opt.value}" ${storedLyricsFont.mode === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');

    const storedDesktopLyricsFont = getStoredDesktopLyricsFont();
    const desktopLyricsFontOptions = getFontOptions(true).map(opt =>
      `<option value="${opt.value}" ${storedDesktopLyricsFont.mode === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');

    const colorEnabled = localStorage.getItem('kimo-color-extraction') !== 'off';
    const colorMode = localStorage.getItem('kimo-color-mode') || 'smart';
    const colorIntensity = parseInt(localStorage.getItem('kimo-color-intensity'), 10) || 0;

    themeCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 1 0 10 10"/></svg>
        外观与界面
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">默认主题</div>
          <div class="setting-desc">设置播放器的默认界面配色主题。</div>
        </div>
        <div class="setting-radio-group" id="settings-theme-group" data-active-idx="${themeVal === 'light' ? '0' : (themeVal === 'grey' ? '1' : '2')}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${themeVal === 'light' ? 'active' : ''}" data-val="light">浅色遮罩</button>
          <button class="setting-radio-btn ${themeVal === 'grey' ? 'active' : ''}" data-val="grey">雅致灰色</button>
          <button class="setting-radio-btn ${themeVal === 'dark' ? 'active' : ''}" data-val="dark">深色遮罩</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">UI 材质与风格</div>
          <div class="setting-desc">选择界面玻璃模糊质感（高斯模糊与液态玻璃效果较消耗显卡性能）。</div>
        </div>
        <div class="setting-radio-group" id="settings-ui-style-group" data-active-idx="${uiStyleVal === 'solid' ? '0' : (uiStyleVal === 'acrylic' ? '1' : (uiStyleVal === 'gaussian' ? '2' : '3'))}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${uiStyleVal === 'solid' ? 'active' : ''}" data-val="solid">默认效果</button>
          <button class="setting-radio-btn ${uiStyleVal === 'acrylic' ? 'active' : ''}" data-val="acrylic">亚克力</button>
          <button class="setting-radio-btn ${uiStyleVal === 'gaussian' ? 'active' : ''}" data-val="gaussian">高斯模糊</button>
          <button class="setting-radio-btn ${uiStyleVal === 'liquid' ? 'active' : ''}" data-val="liquid">液态玻璃</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">背景样式</div>
          <div class="setting-desc">设置播放器主背景效果（动态背景将平滑旋转高斯模糊封面）。</div>
        </div>
        <div class="setting-radio-group" id="settings-bg-style-group" data-active-idx="${bgStyleVal === 'none' ? '0' : (bgStyleVal === 'static' ? '1' : (bgStyleVal === 'dynamic' ? '2' : '3'))}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${bgStyleVal === 'none' ? 'active' : ''}" data-val="none">关闭背景</button>
          <button class="setting-radio-btn ${bgStyleVal === 'static' ? 'active' : ''}" data-val="static">静态背景</button>
          <button class="setting-radio-btn ${bgStyleVal === 'dynamic' ? 'active' : ''}" data-val="dynamic">动态背景</button>
          <button class="setting-radio-btn ${bgStyleVal === 'custom' ? 'active' : ''}" data-val="custom">自定义背景</button>
        </div>
      </div>

      <!-- 自定义背景设置区（仅自定义模式显示） -->
      <div class="setting-row" id="settings-bg-custom-mask-row" style="display: ${bgStyleVal === 'custom' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">背景遮罩</div>
          <div class="setting-desc">开启后由模糊/透明度滑块控制背景效果；关闭后图片原样直出（不受模糊、透明度与 UI 风格影响）。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-bg-mask-enabled" ${bgMaskEnabled ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="setting-row" id="settings-bg-custom-pick-row" style="display: ${bgStyleVal === 'custom' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">自定义背景图片</div>
          <div class="setting-desc">选择本地图片作为播放器背景。透明度滑到 0% 实现全透明（透出桌面）；注意播放条/侧边栏等表面仍保留自身材质，全透明效果以实际窗口为准。</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="setting-btn" id="settings-bg-custom-pick">选择图片</button>
          <span id="settings-bg-custom-name" style="font-size:12px;color:var(--text-tertiary);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${bgCustomName || '未选择'}</span>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">窗口材质</div>
          <div class="setting-desc">Windows 系统级材质：DWM 实时模糊窗口背后的真实内容（桌面）。亚克力/模糊支持 Win10+，云母仅 Win11 22H2+。材质层引擎可在此之上叠加自定义质感。</div>
        </div>
        <div class="setting-radio-group" id="settings-window-material-group" data-active-idx="${windowMaterialVal === 'none' ? '0' : (windowMaterialVal === 'acrylic' ? '1' : (windowMaterialVal === 'mica' ? '2' : '3'))}">
          <div class="setting-radio-active-bg" aria-hidden="true"></div>
          <button class="setting-radio-btn ${windowMaterialVal === 'none' ? 'active' : ''}" data-val="none">无</button>
          <button class="setting-radio-btn ${windowMaterialVal === 'acrylic' ? 'active' : ''}" data-val="acrylic">亚克力</button>
          <button class="setting-radio-btn ${windowMaterialVal === 'mica' ? 'active' : ''}" data-val="mica">云母</button>
          <button class="setting-radio-btn ${windowMaterialVal === 'blur' ? 'active' : ''}" data-val="blur">模糊</button>
        </div>
      </div>
      <div class="setting-row" id="settings-window-opacity-row" style="display: flex;">
        <div class="setting-info">
          <div class="setting-label">窗口透明度</div>
          <div class="setting-desc">作用于整个窗口（壁纸与全部界面一起透明）：0% = 全透明透出桌面，100% = 完全不透明。与背景设置无关。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-window-opacity" min="5" max="100" step="1" value="${bgCustomOpacityPct}">
          <div class="setting-value-display" id="settings-window-opacity-val">${bgCustomOpacityPct}%</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">界面动画速率</div>
          <div class="setting-desc">调整页面与列表入场浮起、按钮 hover 等过渡动画的响应速率。</div>
        </div>
        <div class="setting-radio-group" id="settings-anim-speed-group" data-active-idx="${(localStorage.getItem('kimo-anim-speed') || 'slow') === 'slow' ? '0' : ((localStorage.getItem('kimo-anim-speed') || 'slow') === 'fast' ? '1' : '2')}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${(localStorage.getItem('kimo-anim-speed') || 'slow') === 'slow' ? 'active' : ''}" data-val="slow">舒缓平滑</button>
          <button class="setting-radio-btn ${(localStorage.getItem('kimo-anim-speed') || 'slow') === 'fast' ? 'active' : ''}" data-val="fast">极速敏捷</button>
          <button class="setting-radio-btn ${(localStorage.getItem('kimo-anim-speed') || 'slow') === 'none' ? 'active' : ''}" data-val="none">关闭动画</button>
        </div>
      </div>

      <div class="setting-row" id="settings-bg-rotate-speed-row" style="display: ${bgStyleVal === 'dynamic' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">动态背景旋转速率</div>
          <div class="setting-desc">调整背景封面的旋转速度。拖动滑块时暂停旋转，释放后应用。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-bg-rotate-speed" min="10" max="100" step="5" value="${bgRotatePct}">
          <div class="setting-value-display" id="settings-bg-rotate-speed-val">${bgRotatePct}%</div>
        </div>
      </div>

      <div class="setting-row" id="settings-overlay-opacity-row" style="display: ${bgStyleVal === 'static' || bgStyleVal === 'dynamic' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">背景遮罩不透明度</div>
          <div class="setting-desc">微调背景高斯模糊遮罩层的不透明度（仅静态/动态背景有效；关闭背景与自定义背景不适用）。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-opacity" min="0" max="100" step="1" value="${opacityNum}">
          <div class="setting-value-display" id="settings-opacity-val">${opacityNum}%</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">材质引擎预览（实验）</div>
          <div class="setting-desc">启用新材质引擎（Canvas2D 管线，docs/material-layer-architecture.md）接管背景层，渲染玻璃材质效果。默认关闭。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-material-engine-preview" ${materialEnginePreview ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">界面字体</div>
          <div class="setting-desc">内置字体不可删除；也可添加本地 TTF、OTF、WOFF 字体文件。</div>
        </div>
        <div class="setting-font-controls">
          <select class="setting-select" id="settings-interface-font">
            ${interfaceFontOptions}
            <option value="custom" ${interfaceFont.mode === 'custom' ? 'selected' : ''}>自定义字体</option>
          </select>
          <button class="setting-btn" id="settings-font-manage-btn">管理字体</button>
          <div class="setting-font-file" id="settings-custom-font-file" title="${interfaceFont.customPath}">${getFontFileName(interfaceFont.customPath)}</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">软件界面缩放</div>
          <div class="setting-desc">调整播放器界面整体缩放，以适配高分屏或小屏设备。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-zoom" min="80" max="120" step="1" value="${zoomPercent}">
          <div class="setting-value-display" id="settings-zoom-val">${zoomPercent}%</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">专辑封面取色</div>
          <div class="setting-desc">提取当前播放歌曲的封面颜色作为界面主题强调色。</div>
        </div>
        <label class="setting-toggle" title="切换专辑封面取色">
          <input type="checkbox" id="settings-color-extraction-toggle" ${colorEnabled ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row" id="settings-color-mode-row" style="display: ${colorEnabled ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">取色模式</div>
          <div class="setting-desc">智能模式自动适配最佳亮度，手动模式可自由调节取色深浅。</div>
        </div>
        <div class="setting-radio-group" id="settings-color-mode-group" data-active-idx="${colorMode === 'smart' ? '0' : '1'}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${colorMode === 'smart' ? 'active' : ''}" data-val="smart">智能取色</button>
          <button class="setting-radio-btn ${colorMode === 'manual' ? 'active' : ''}" data-val="manual">手动调节</button>
        </div>
      </div>

      <div class="setting-row" id="settings-color-intensity-row" style="display: ${colorEnabled && colorMode === 'manual' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">取色深浅</div>
          <div class="setting-desc">向左偏深，向右偏浅。中间为平衡值。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-color-intensity" min="-50" max="50" step="1" value="${colorIntensity}">
          <div class="setting-value-display" id="settings-color-intensity-val">${colorIntensity > 0 ? '+' : ''}${colorIntensity}</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">显示音质标签</div>
          <div class="setting-desc">在歌曲列表中展示音质等级徽章（如 SQ、Hi-Res、HQ）。</div>
        </div>
        <label class="setting-toggle" title="切换音质标签展示">
          <input type="checkbox" id="settings-show-quality-badge" ${showQualityBadgeVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">显示码率标签</div>
          <div class="setting-desc">在歌曲列表中展示具体传输码率数字。</div>
        </div>
        <label class="setting-toggle" title="切换码率标签展示">
          <input type="checkbox" id="settings-show-bitrate-badge" ${showBitrateBadgeVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
    `;
    container.appendChild(themeCard);

    // ════════════════════════════════════════════════
    // 2. 🎵 歌词与面板 (Lyrics & Panel Settings)
    // ════════════════════════════════════════════════
    const lyricCard = document.createElement('div');
    lyricCard.className = 'settings-card';
    lyricCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        歌词与面板
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词页面主题</div>
          <div class="setting-desc">单独设置全屏歌词页面的主题风格。</div>
        </div>
        <div class="setting-radio-group" id="settings-lyrics-theme-group" data-active-idx="${lyricsThemeVal === 'follow' ? '0' : (lyricsThemeVal === 'light' ? '1' : '2')}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${lyricsThemeVal === 'follow' ? 'active' : ''}" data-val="follow">自动</button>
          <button class="setting-radio-btn ${lyricsThemeVal === 'light' ? 'active' : ''}" data-val="light">浅色</button>
          <button class="setting-radio-btn ${lyricsThemeVal === 'dark' ? 'active' : ''}" data-val="dark">深色</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词页面字体</div>
          <div class="setting-desc">单独为全屏歌词页面与歌词面板设置显示字体。</div>
        </div>
        <div class="setting-font-controls">
          <select id="settings-lyrics-font" class="setting-select">
            ${lyricsFontOptions}
          </select>
          <button class="setting-btn" id="settings-custom-lyrics-font-btn">选择字体文件</button>
          <div class="setting-font-file" id="settings-custom-lyrics-font-file" title="${storedLyricsFont.customPath}">
            ${getFontFileName(storedLyricsFont.customPath)}
          </div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词动画切换模式</div>
          <div class="setting-desc">设置卡拉OK歌词按字母依次上移或按单词整体滚动。</div>
        </div>
        <div class="setting-radio-group" id="settings-stagger-group" data-active-idx="${staggerMode === 'stagger' ? '0' : '1'}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${staggerMode === 'stagger' ? 'active' : ''}" data-val="stagger">字母依次</button>
          <button class="setting-radio-btn ${staggerMode === 'word' ? 'active' : ''}" data-val="word">单词整体</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词逐行跟随动画</div>
          <div class="setting-desc">切换歌词时，下方多行歌词呈现层次跟随滚动动画。</div>
        </div>
        <label class="setting-toggle" title="切换歌词逐行跟随动画">
          <input type="checkbox" id="settings-lyrics-row-follow" ${rowFollowAnimationVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词默认字号</div>
          <div class="setting-desc">调整全屏歌词面板中的文字字号大小。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-font-size" min="16" max="48" step="0.5" value="${fontSize}">
          <div class="setting-value-display" id="settings-font-size-val">${fontSize.toFixed(1)}px</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词行间距</div>
          <div class="setting-desc">调整全屏歌词上下行之间的间距。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-line-spacing" min="0" max="2.0" step="0.05" value="${lineSpacing}">
          <div class="setting-value-display" id="settings-line-spacing-val">${lineSpacing.toFixed(2)}</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">歌词上抬动画幅度</div>
          <div class="setting-desc">正在发音的歌词向上抬升的动画高度。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-slider-lift" min="0" max="5" step="1" value="${liftAmp}">
          <div class="setting-value-display" id="settings-lift-val">${liftAmp}px</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">过滤歌曲信息</div>
          <div class="setting-desc">自动隐藏歌词开头的作词、作曲及制作人员署名行。</div>
        </div>
        <label class="setting-toggle" title="过滤歌词中的歌曲信息与制作人员署名">
          <input type="checkbox" id="settings-lyrics-filter-info" ${filterLyricInfoVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">迷你歌词显示翻译</div>
          <div class="setting-desc">在底部播放栏中央的迷你歌词下方显示翻译。</div>
        </div>
        <label class="setting-toggle" title="切换迷你歌词翻译">
          <input type="checkbox" id="settings-mini-translation" ${miniTransVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">迷你歌词字号</div>
          <div class="setting-desc">调整底部播放栏中央迷你歌词的字号大小。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-mini-lyrics-size" min="11" max="18" step="0.5" value="${miniLyricsFontSize}">
          <div class="setting-value-display" id="mini-lyrics-size-val">${miniLyricsFontSize.toFixed(1)}px</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">沉浸模式隐藏标题栏</div>
          <div class="setting-desc">进入全屏沉浸歌词模式时隐藏窗口顶栏按钮。</div>
        </div>
        <label class="setting-toggle" title="切换沉浸模式隐藏标题栏">
          <input type="checkbox" id="settings-immersive-hide-titlebar" ${localStorage.getItem('kimo-immersive-hide-titlebar') === 'false' ? '' : 'checked'} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
    `;
    container.appendChild(lyricCard);

    // ════════════════════════════════════════════════
    // 3. 🖥️ 桌面歌词 (Desktop Lyrics)
    // ════════════════════════════════════════════════
    const desktopLyricCard = document.createElement('div');
    desktopLyricCard.className = 'settings-card';
    desktopLyricCard.innerHTML = `
      <div class="settings-card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        桌面歌词
      </div>

      <!-- 🖥️ 桌面歌词实时效果预览组件 -->
      <div class="desktop-lyrics-preview-wrapper">
        <div class="desktop-lyrics-preview-header">
          <span>桌面歌词效果预览</span>
          <span class="desktop-lyrics-preview-badge">实时渲染</span>
        </div>
        <div class="desktop-lyrics-preview-box" id="desktop-lyrics-preview-box">
          <div class="desktop-lyrics-preview-toolbar-mock">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></svg>
            <span>桌面歌词</span>
          </div>
          <div class="desktop-lyrics-preview-viewport" id="desktop-lyrics-preview-viewport">
            <div class="desktop-lyrics-preview-main" id="desktop-lyrics-preview-main">
              ♪ 这一刻 画面定格在眼前 ♪
            </div>
            <div class="desktop-lyrics-preview-sub" id="desktop-lyrics-preview-sub">
              This moment is frozen in time
            </div>
          </div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">开启桌面歌词</div>
          <div class="setting-desc">在桌面上显示浮动置顶歌词。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics" ${desktopLyricsEnabled ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">桌面歌词字体</div>
          <div class="setting-desc">单独为桌面悬浮歌词设置显示字体。</div>
        </div>
        <div class="setting-font-controls">
          <select id="settings-desktop-lyrics-font" class="setting-select">
            ${desktopLyricsFontOptions}
          </select>
          <button class="setting-btn" id="settings-custom-desktop-font-btn">选择字体文件</button>
          <div class="setting-font-file" id="settings-custom-desktop-font-file" title="${storedDesktopLyricsFont.customPath}">
            ${getFontFileName(storedDesktopLyricsFont.customPath)}
          </div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">锁定桌面歌词 (鼠标穿透)</div>
          <div class="setting-desc">锁定后支持鼠标完全穿透，防止误触拖动。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics-locked" ${desktopLyricsLocked ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">桌面歌词字号</div>
          <div class="setting-desc">调整桌面歌词文字显示字号。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-desktop-lyrics-size" min="12" max="56" step="1" value="${desktopLyricsFontSize}">
          <div class="setting-value-display" id="desktop-lyrics-size-val">${desktopLyricsFontSize}px</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">桌面歌词透明度</div>
          <div class="setting-desc">调整桌面歌词窗口的不透明度。</div>
        </div>
        <div class="setting-slider-wrapper">
          <input type="range" class="setting-slider" id="settings-desktop-lyrics-opacity" min="0.25" max="1" step="0.05" value="${desktopLyricsOpacity}">
          <div class="setting-value-display" id="desktop-lyrics-opacity-val">${Math.round(desktopLyricsOpacity * 100)}%</div>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">桌面歌词逐字动画</div>
          <div class="setting-desc">展示平滑的逐字高亮/卡拉OK流光效果。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics-word-by-word" ${desktopLyricsWordByWord ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">显示歌词翻译</div>
          <div class="setting-desc">在桌面歌词下方显示对应的翻译字幕。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics-translation" ${desktopLyricsShowTranslation ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">桌面歌词显示模式</div>
          <div class="setting-desc">设置桌面歌词显示单行（仅当前句）或双行（当前句与下一句预读）。</div>
        </div>
        <div class="setting-radio-group" id="settings-desktop-lyrics-line-mode-group" data-active-idx="${desktopLyricsLineMode === 'double' ? '1' : '0'}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${desktopLyricsLineMode !== 'double' ? 'active' : ''}" data-val="single">单行模式</button>
          <button class="setting-radio-btn ${desktopLyricsLineMode === 'double' ? 'active' : ''}" data-val="double">双行模式</button>
        </div>
      </div>

      <div class="setting-row" id="settings-desktop-lyrics-layout-row" style="display: ${desktopLyricsLineMode === 'double' ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">双行排列</div>
          <div class="setting-desc">上下排列或左右分栏（左右分栏会自动调整窗口大小）。</div>
        </div>
        <div class="setting-radio-group" id="settings-desktop-lyrics-layout-group" data-active-idx="${desktopLyricsLayout === 'split' ? '1' : '0'}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${desktopLyricsLayout !== 'split' ? 'active' : ''}" data-val="stacked">上下排列</button>
          <button class="setting-radio-btn ${desktopLyricsLayout === 'split' ? 'active' : ''}" data-val="split">左右分栏</button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">字体阴影</div>
          <div class="setting-desc">提供霓虹发光与背景阴影效果。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics-glow" ${desktopLyricsGlow ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">字体描边</div>
          <div class="setting-desc">提供文字描边以防止浅色壁纸背景下模糊。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-desktop-lyrics-stroke" ${desktopLyricsStroke ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">自定义歌词颜色</div>
          <div class="setting-desc">自由设置已播放与未播放歌词颜色，关闭后跟随配色预设。</div>
        </div>
        <label class="setting-toggle" title="开启自定义歌词颜色">
          <input type="checkbox" id="settings-desktop-lyrics-custom-color" ${desktopLyricsCustomColor ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="setting-row" id="settings-desktop-lyrics-color-row" style="display: ${desktopLyricsCustomColor ? 'flex' : 'none'};">
        <div class="setting-info">
          <div class="setting-label">已播放 / 未播放颜色</div>
          <div class="setting-desc">左侧为已播放歌词颜色，右侧为未播放歌词颜色（含第二行）。</div>
        </div>
        <div class="setting-color-pickers">
          <label class="setting-color-picker">
            <span>已播放</span>
            <input type="color" id="settings-desktop-lyrics-color-active" value="${desktopLyricsActiveColor || '#00f2fe'}" />
          </label>
          <label class="setting-color-picker">
            <span>未播放</span>
            <input type="color" id="settings-desktop-lyrics-color-inactive" value="${desktopLyricsInactiveColor || '#ffffff'}" />
          </label>
        </div>
      </div>

      <div class="setting-row" id="settings-desktop-lyrics-theme-row" style="display: ${desktopLyricsCustomColor ? 'none' : 'flex'};">
        <div class="setting-info">
          <div class="setting-label">配色预设</div>
          <div class="setting-desc">选择桌面歌词内置主题配色。</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="settings-desktop-lyrics-theme" class="setting-select">
            <option value="follow-app" ${desktopLyricsTheme === 'follow-app' ? 'selected' : ''}>跟随软件主题 (Auto)</option>
            <option value="aurora" ${desktopLyricsTheme === 'aurora' ? 'selected' : ''}>极光青绿 (Aurora)</option>
            <option value="cyber" ${desktopLyricsTheme === 'cyber' ? 'selected' : ''}>赛博粉紫 (Cyber)</option>
            <option value="sunset" ${desktopLyricsTheme === 'sunset' ? 'selected' : ''}>夕阳金橙 (Sunset)</option>
            <option value="ocean" ${desktopLyricsTheme === 'ocean' ? 'selected' : ''}>蔚蓝深海 (Ocean)</option>
            <option value="white" ${desktopLyricsTheme === 'white' ? 'selected' : ''}>经典亮白 (White)</option>
          </select>
        </div>
      </div>

      <div class="setting-row" id="settings-desktop-lyrics-align-row" style="display: ${desktopLyricsLineMode === 'double' ? 'none' : 'flex'};">
        <div class="setting-info">
          <div class="setting-label">文字对齐</div>
          <div class="setting-desc">选择桌面歌词的文字对齐方式（单行模式可用）。</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="settings-desktop-lyrics-align" class="setting-select">
            <option value="center" ${desktopLyricsAlign === 'center' ? 'selected' : ''}>居中对齐</option>
            <option value="left" ${desktopLyricsAlign === 'left' ? 'selected' : ''}>靠左对齐</option>
            <option value="right" ${desktopLyricsAlign === 'right' ? 'selected' : ''}>靠右对齐</option>
          </select>
        </div>
      </div>
    `;
    container.appendChild(desktopLyricCard);

    // ════════════════════════════════════════════════
    // 4. ▶️ 播放与曲库 (Playback & Library)
    // ════════════════════════════════════════════════
    const playbackCard = document.createElement('div');
    playbackCard.className = 'settings-card';
    const autoPlayVal = localStorage.getItem('kimo-auto-play-on-start') === 'true';

    let pathsHtml = '';
    if (scannedDirs.length === 0) {
      pathsHtml = `<div class="scanned-paths-empty">暂无已添加的扫描文件夹目录，请点击下方按钮添加。</div>`;
    } else {
      pathsHtml = `<div class="scanned-paths-list">`;
      scannedDirs.forEach((dir, index) => {
        pathsHtml += `
          <div class="scanned-path-item">
            <div class="scanned-path-text" title="${dir}">${dir}</div>
            <button class="scanned-path-remove" data-idx="${index}" title="移出列表">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        `;
      });
      pathsHtml += `</div>`;
    }

    playbackCard.id = 'settings-scan-card';
    playbackCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        播放与曲库管理
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">启动自动播放</div>
          <div class="setting-desc">打开软件时，自动继续播放上次关闭前播放的歌曲。</div>
        </div>
        <label class="setting-toggle" title="切换启动自动播放">
          <input type="checkbox" id="settings-autoplay-on-start" ${autoPlayVal ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">列表播放触发方式</div>
          <div class="setting-desc">选择在歌曲列表中触发播放所需的点击操作。</div>
        </div>
        <div class="setting-radio-group" id="settings-song-play-mode" data-active-idx="${songPlayMode === 'double' ? '1' : '0'}">
          <div class="setting-radio-active-bg"></div>
          <button class="setting-radio-btn ${songPlayMode === 'single' ? 'active' : ''}" data-val="single">单击播放</button>
          <button class="setting-radio-btn ${songPlayMode === 'double' ? 'active' : ''}" data-val="double">双击播放</button>
        </div>
      </div>

      <div style="width: 100%; height: 1px; background: var(--glass-border); margin: 10px 0;"></div>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">本地音乐文件夹扫描管理</div>
        ${pathsHtml}
        <div class="settings-actions">
          <button class="setting-btn" id="settings-clear-dirs">清空歌曲缓存</button>
          <button class="setting-btn" id="settings-add-dir-btn">添加文件夹</button>
          <button class="setting-btn accent" id="settings-scan-btn">立即重新扫描</button>
        </div>
      </div>
    `;
    container.appendChild(playbackCard);

    // ════════════════════════════════════════════════
    // 5. 🌐 扩展服务 (Extensions & Network Services)
    // ════════════════════════════════════════════════
    const extCard = document.createElement('div');
    extCard.className = 'settings-card';
    const savedLunaUrl = JSON.parse(localStorage.getItem('kimo-lunabeat-config') || '{}').baseUrl || '';
    const savedLunaPin = JSON.parse(localStorage.getItem('kimo-lunabeat-config') || '{}').pinCode || '';
    const savedLunaEnabled = JSON.parse(localStorage.getItem('kimo-lunabeat-config') || '{}').enabled || false;
    // 默认参与统计（保持既有行为）
    const lunaStatsEnabled = localStorage.getItem('kimo-luna-stats-enabled') !== 'false';
    extCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        扩展服务
      </div>

      <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">LunaBeat 局域网音源</div>
      <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 10px; line-height: 1.5;">
        连接手机端 LunaBeat App，直接播放局域网音乐。
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">启用局域网音源</div>
          <div class="setting-desc">开启后在侧边栏显示「局域网(LB)」入口。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-luna-enabled" ${savedLunaEnabled ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">局域网歌曲参与月度统计</div>
          <div class="setting-desc">开启后，局域网歌曲的播放次数计入「月度听歌报告」，并缓存上榜歌曲封面供离线显示。</div>
        </div>
        <label class="setting-toggle">
          <input type="checkbox" id="settings-luna-stats" ${lunaStatsEnabled ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">服务器地址</div>
          <div class="setting-desc">LunaBeat Web 服务的 IP 与端口（如 http://192.168.x.x:8787）。</div>
        </div>
        <input type="text" class="setting-input" id="settings-luna-url" value="${savedLunaUrl}" placeholder="http://192.168.x.x:8787" style="min-width: 200px;">
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">配对码 (PIN)</div>
          <div class="setting-desc">LunaBeat App 设置 → 局域网 Web 音乐服务中显示的配对码。</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="password" class="setting-input" id="settings-luna-pin" value="${savedLunaPin}" placeholder="请输入配对码" style="min-width:140px;">
          <button class="setting-btn accent" id="settings-luna-save-btn">保存&amp;测试</button>
        </div>
      </div>
      <div id="settings-luna-status" style="font-size:12px;margin-top:8px;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.05);color:var(--text-tertiary);"></div>

      <div style="width: 100%; height: 1px; background: var(--glass-border); margin: 16px 0 12px;"></div>

      <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">AI 语音识别服务 (ASR)</div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">推理服务器地址 (Server URL)</div>
          <div class="setting-desc">Whisper 音频时间戳对齐与歌词识别后台服务接口。</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <input type="text" class="setting-input" id="settings-asr-url" value="${aiServerUrl}">
          <button class="setting-btn accent" id="settings-save-asr-btn">保存</button>
        </div>
      </div>
    `;
    container.appendChild(extCard);

    // ════════════════════════════════════════════════
    // 6. ⚡ 硬件性能 (Performance Settings)
    // ════════════════════════════════════════════════
    const perfCard = document.createElement('div');
    perfCard.className = 'settings-card';
    const isPerfMode = localStorage.getItem('kimo-performance-mode') === 'true';
    perfCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        硬件性能
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">开启低功耗性能模式</div>
          <div class="setting-desc">减少高斯模糊与景深渲染，降低 CPU 与 GPU 资源占用，提升低配设备流畅度。</div>
        </div>
        <label class="setting-toggle" title="切换低功耗性能模式">
          <input type="checkbox" id="settings-perf-mode" ${isPerfMode ? 'checked' : ''} />
          <span class="setting-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
    `;
    container.appendChild(perfCard);

    playbackCard.querySelector('#settings-autoplay-on-start')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-auto-play-on-start', e.target.checked);
      showToast(`已${e.target.checked ? '开启' : '关闭'}启动自动播放`);
    });

    playbackCard.querySelectorAll('#settings-song-play-mode .setting-radio-btn').forEach((button, index) => {
      button.addEventListener('click', () => {
        playbackCard.querySelectorAll('#settings-song-play-mode .setting-radio-btn').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        playbackCard.querySelector('#settings-song-play-mode').setAttribute('data-active-idx', String(index));
        const mode = button.dataset.val;
        localStorage.setItem('kimo-song-play-mode', mode);
        showToast(`已切换为${mode === 'double' ? '双击播放' : '单击播放'}`);
      });
    });

    const scanCard = playbackCard;

    // 关于软件 Card
    const aboutCard = document.createElement('div');
    aboutCard.className = 'settings-card';
    aboutCard.innerHTML = `
      <div class="settings-card-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        关于软件
      </div>
      
      <div class="setting-row" style="flex-direction: column; align-items: flex-start; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
          <div class="about-logo" style="width: 48px; height: 48px; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <img src="/logo.png" alt="KimoPlayer" style="width: 100%; height: 100%; object-fit: cover; display: block;" />
          </div>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size: 18px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.5px;">KimoPlayer</span>
              <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:rgba(16,185,129,0.12);color:rgb(16,185,129);border:1px solid rgba(16,185,129,0.2);">开源</span>
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">版本: ${APP_VERSION}</div>
          </div>
          <div id="settings-github-link" style="cursor:pointer;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);transition:all 0.2s;" title="GitHub 仓库">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text-secondary);"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          </div>
        </div>
        
        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; font-family: var(--font-family);">
          KimoPlayer 是一款轻量、精美的本地音频播放器。支持卡拉OK逐词歌词同步与编辑制作、歌词离线检索匹配、流畅的歌词滚动对齐以及极简的毛玻璃动态背景，为您带来纯净、舒适的本地音乐播放体验。
        </div>
        
                <div style="width: 100%; height: 1px; background: var(--glass-border); margin: 8px 0;"></div>

        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-tertiary); width: 100%;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>核心技术</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="tech-badge" title="Tauri" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;color:var(--text-secondary);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="#ffc131"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" fill="#ffc131" opacity="0.3"/></svg>
                Tauri
              </span>
              <span class="tech-badge" title="Rust" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;color:var(--text-secondary);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M3 3h9v9H3V3zm9 9h9v9h-9v-9zm-9 0h9v9H3v-9z" fill="#dea584" opacity="0.8"/></svg>
                Rust
              </span>
              <span class="tech-badge" title="Vite" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;color:var(--text-secondary);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21.805 5.27L12.616 21.272l-2.048-6.496L3.195 5.27h18.61zM12.616 16.728l4.304-11.458H5.08l7.536 11.458z" fill="#646cff"/></svg>
                Vite
              </span>
              <span class="tech-badge" title="Vanilla JS" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;color:var(--text-secondary);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#f7df1e"/><text x="12" y="17" text-anchor="middle" font-size="12" font-weight="bold" fill="#323330">JS</text></svg>
                JS
              </span>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>开源仓库</span>
            <span style="color: var(--text-secondary);cursor:pointer;" id="settings-github-text">github.com/kiomosu/KimoPlayer</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>版权所有</span>
            <span style="color: var(--text-secondary);">© 2026 KimoPlayer. 保留所有权。</span>
          </div>
        </div>

        <div style="width: 100%; height: 1px; background: var(--glass-border); margin: 8px 0;"></div>

        <div style="display:flex;flex-direction:column;gap:6px;width:100%;">
          <div id="settings-changelog-btn" class="setting-row" style="cursor: pointer; margin: 0; padding: 10px 14px; border-radius: 10px; transition: background 0.2s;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              <span style="font-size: 13px; color: var(--text-primary);">查看历史更新</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          <div style="display:flex;gap:8px;padding:4px 14px 2px;">
            <button id="settings-check-update-btn" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;font-size:12px;font-weight:600;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,0.03);color:var(--text-primary);cursor:pointer;white-space:nowrap;transition:all 0.2s;">
              <svg id="check-update-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span id="check-update-text">检查更新</span>
            </button>
            <button id="settings-beta-btn" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;font-size:12px;font-weight:600;border:1px solid var(--glass-border);border-radius:10px;${getBetaStatus() ? 'background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.3);color:rgb(16,185,129);' : 'background:rgba(255,255,255,0.03);color:var(--text-primary);'}cursor:pointer;white-space:nowrap;transition:all 0.2s;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
              <span>${getBetaStatus() ? '已加入测试' : '加入测试'}</span>
            </button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(aboutCard);
    container.appendChild(noResultsEl);

    // 🔍 实时搜索过滤逻辑
    const searchInput = searchHeader.querySelector('#settings-search-input');
    const searchClearBtn = searchHeader.querySelector('#settings-search-clear');
    const searchCountEl = searchHeader.querySelector('#settings-search-result-count');

    const filterSettings = (query) => {
      const trimmed = (query || '').trim().toLowerCase();
      if (!trimmed) {
        searchClearBtn.style.display = 'none';
        searchCountEl.style.display = 'none';
        noResultsEl.style.display = 'none';
        container.querySelectorAll('.settings-card').forEach(card => {
          card.style.display = '';
          card.querySelectorAll('.setting-row').forEach(row => row.style.display = '');
        });
        return;
      }

      searchClearBtn.style.display = 'flex';
      const keywords = trimmed.split(/\s+/).filter(Boolean);
      let totalMatches = 0;

      const cards = container.querySelectorAll('.settings-card');
      cards.forEach(card => {
        const cardTitle = card.querySelector('.settings-card-title')?.textContent?.toLowerCase() || '';
        const rows = card.querySelectorAll('.setting-row');
        let cardVisibleCount = 0;

        rows.forEach(row => {
          const label = row.querySelector('.setting-label')?.textContent?.toLowerCase() || '';
          const desc = row.querySelector('.setting-desc')?.textContent?.toLowerCase() || '';
          const fullText = `${cardTitle} ${label} ${desc}`;

          const isMatch = keywords.every(kw => fullText.includes(kw));
          if (isMatch) {
            row.style.display = '';
            cardVisibleCount++;
          } else {
            row.style.display = 'none';
          }
        });

        // 检查卡片内是否有非 row 区域标题匹配 (例如 LunaBeat / ASR 区域标题)
        const subTitles = card.querySelectorAll('div[style*="font-weight: 600"]');
        let subMatch = false;
        subTitles.forEach(st => {
          if (keywords.every(kw => st.textContent.toLowerCase().includes(kw))) {
            subMatch = true;
          }
        });

        if (cardVisibleCount > 0 || subMatch) {
          card.style.display = '';
          totalMatches += cardVisibleCount || 1;
        } else {
          card.style.display = 'none';
        }
      });

      if (totalMatches === 0) {
        noResultsEl.style.display = 'flex';
        const kwEl = noResultsEl.querySelector('#settings-no-results-keyword');
        if (kwEl) kwEl.textContent = query.trim();
        searchCountEl.style.display = 'none';
      } else {
        noResultsEl.style.display = 'none';
        searchCountEl.style.display = 'block';
        searchCountEl.textContent = `包含 ${totalMatches} 项匹配`;
      }
    };

    searchInput?.addEventListener('input', (e) => filterSettings(e.target.value));
    searchClearBtn?.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        filterSettings('');
        searchInput.focus();
      }
    });

        // 历史更新公告数据
    const changelogData = [
      {
        version: '1.8.2',
        date: '2026.08.05',
        type: '更新',
        sections: [
          { title: '✨ 优化与修复', items: [
            '修复设置页预览框：补全缺失的预设特效阴影，并在选中渐变主题时可以正确显示高光填充。',
            '设置页逻辑解耦：完全拆分原有的主题预设和文字对齐控制。在应用自定义颜色或开启双行模式时，将正确隐藏可能引起冲突的对应设置行。',
            '设置页交互动效：重写了所有因状态变化而动态显示/隐藏的设置行，新增抽屉式弹性过渡动画，告别生硬闪烁。'
          ] }
        ],
      },
      {
        version: '1.8.1',
        date: '2026.08.05',
        type: '体验打磨',
        sections: [
          { title: '🎤 桌面歌词优化', items: [
            '色彩自由定义：新增歌词颜色自定义功能，现在您可以分别设置“已唱”与“未唱”歌词的专属色彩',
            '多行对齐模式：新增单行/双行模式自由无缝切换，双行模式现已支持“左对齐”与“交叉对齐”',
            '双行平滑过渡：彻底修复了双行模式下，第二句歌词在等待开唱时出现的左右高频抖动问题',
            '纯净沉浸展示：移除了超长歌词的自动左右摇摆滚动效果，文本将始终保持静止并居中对齐'
          ] },
          { title: '🎨 界面与系统焕新', items: [
            '全新托盘界面：重新设计了系统托盘菜单，不仅颜值大幅提升，功能交互也更加直观实用',
            '专属文件图标：在系统级全局实装全新设计的 Windows 音频文件关联图标（支持 12 种主流格式）',
            '个性字体管理：全新上线字体管理中心，可一键下载应用内推荐字体，也支持安装新的自定义字体'
          ] }
        ],
      },
      {
        version: '1.8.0',
        date: '2026.08.03',
        type: '更新日志',
        sections: [
          { title: '🌐 局域网', items: [
            '优化界面，新增加载动画、状态显示与刷新按钮',
            '新增歌曲搜索功能',
            '优化专辑界面滚动卡顿',
            '重构二级页面样式，优化进入动画',
          ] },
          { title: '🎨 界面', items: [
            '新增设置搜索，可快速查找设置项',
            '修复底栏音质标签渲染失效',
            '设置页标题层次优化',
          ] },
          { title: '🖼️ 壁纸与背景', items: [
            '新增自定义壁纸功能',
            '新增背景遮罩开关',
            '新增窗口透明度调整',
            '新增窗口材质（实验性）',
          ] },
          { title: '🎤 歌词', items: [
            '优化抬起动画帧率与卡拉OK渐变过渡',
            '新增桌面歌词双行模式',
            '新增桌面歌词样式实时预览',
            '修复桌面歌词滚动抖动与行末露不全',
            '修复桌面歌词开关偶尔打开多个窗口',
          ] },
          { title: '⚡ 性能', items: [
            '优化本地全部歌曲列表与详情页滚动卡顿',
          ] },
          { title: '🛠️ 其他', items: [
            '新增思源黑体作为默认字体',
            '开发者工具改为隐藏式入口，点击设置页软件图标 5 次开启',
            '修复发现页/最近播放页点击歌曲后页面错乱',
            '修复部分滑块在不同设置选项下显示错位',
          ] },
        ],
      },
      {
        version: '1.7.2',
        date: '2026.08.02',
        type: '歌词卡拉OK同源对齐与设置交互修复',
        sections: [
          { title: '🎤 歌词卡拉OK与动效体验', items: [
            '主界面歌词引擎与桌面歌词 1:1 同源对齐，走字与亮灯效果保持完全一致',
            'CSS 渐变涂色公式与游标匹配深度统一，解决文字不走字与填充错位问题',
            '恢复 AMLL 逐字抬起弹跳动画（Word Lift Bounce），带来更具动感的歌词视觉体感',
            '优化日语假名注音（Ruby）的高光剪裁与多图层物理隔离，解决注音重影',
          ] },
          { title: '🛠️ 设置界面与系统优化', items: [
            '修复设置界面中“歌词页面主题”（自动/浅色/深色）点击无响应的问题，支持实时切换与保存',
            '修复设置界面 DOM 挂载逻辑，保证面板秒开与顺畅加载',
            '修正 LunaBeat 局域网连字符 UUID 封面正则与 LRU Blob URL 缓存释放，清除控制台 404 报错',
          ] },
        ],
      },
      {
        version: '1.7.1',
        date: '2026.08.01',
        type: '局域网播放全面增强与滚动体验优化',
        sections: [
          { title: '🌐 局域网播放（LunaBeat）全面增强', items: [
            '全新接入 LunaBeat 局域网曲库，可直接浏览并播放手机 App 中的音乐',
            '封面加载增加淡入过渡动画，快速滚动时不再出现突兀跳转',
            '列表风格与本地界面保持视觉统一：按钮、标签、高亮、播放状态无缝一致',
            '播放全部按钮移至工具栏左侧，与连接状态、刷新按钮形成清晰的操作区',
            '定制局域网专属右键菜单，操作逻辑与本地音乐场景对齐',
            '点击播放歌曲时列表不再跳动、所有封面不再集体闪烁，播放状态改为局部 DOM 刷新',
            '修复局域网歌曲播放时列表播放状态一闪而过的问题，支持跨模块 _lunaId 与 file_path 双 ID 匹配',
            '列表渲染采用虚拟滚动 + 哨兵触底分批追加，千首级大曲库首次进入同样秒开',
            '封面图片接入 IntersectionObserver 懒加载与 LRU Blob URL 缓存，滚动时零卡顿、无内存暴涨',
            '进入局域网列表、切换子视图时增加交错入场动画，首次进入不再丢帧',
          ] },
          { title: '✨ 滚动体验深度优化', items: [
            '移除内容区手动滚动干预逻辑，完全交由浏览器原生平滑滚动驱动，彻底消除滚轮顿挫感',
            '优化 .content-area、.song-item 等关键容器的渲染属性，减少滚动时多余的图层合成',
            '发现页滚动监听统一设为被动（passive），避免浏览器等待事件处理导致滚动滞后',
          ] },
          { title: '🛠️ 稳定性与布局修复', items: [
            '修复从局域网页面切回搜索界面后工具栏样式错乱、布局错位的问题',
            '工具栏在每次渲染时重置 className，避免上一个页面残留的样式类污染',
            '加大歌词沉浸页左侧封面区域宽度，返回按钮位置保持不变，留白更舒展',
          ] },
        ],
      },
      {
        version: '1.7.0',
        date: '2026.07.31',
        type: '局域网播放秒开与界面体验优化',
        sections: [
          { title: '⚡ 局域网播放秒开', items: ['播放手机 LunaBeat 歌曲秒点秒播，无需漫长等待，拖动进度条丝滑不卡顿'] },
          { title: '🎨 背景与界面优化', items: ['局域网歌曲完美支持沉浸毛玻璃背景，修复部分界面背景纯黑的问题', '修复歌曲列表时长显示超长小数尾巴的 Bug', '修复歌词沉浸页切歌按钮挤压变形的问题'] },
          { title: '✏️ 体验与细节修复', items: ['将应用顶栏及全局各处的软件名称统一更正为 KimoPlayer', '优化最近播放记录的封面展示'] },
        ],
      },
      {
        version: '1.6.1',
        date: '2026.07.30',
        type: '歌词滚动与布局修复',
        sections: [
          { title: '歌词滚动与时间状态', items: ['修复间奏展开、收起引起的歌词错位，间奏位置继承下一句声道布局', '支持一句同时与上一句、下一句重叠演唱，越过结束点后立即切换下一组', '修复点击歌词跳转时上一句错误保持高亮，以及逐字单元首字提前染色'] },
          { title: '布局与沉浸模式', items: ['小窗口提高歌词区域占比，沉浸模式恢复左右 1:1 布局', '沉浸模式歌词字号直接提升至设置上限，退出后恢复原字号', '封面保持正方形并随窗口缓慢放大，歌词舞台在宽屏下整体居中'] },
          { title: '设置与交互', items: ['新增歌词歌曲信息过滤，可隐藏标题、歌手及作词、作曲、编曲等署名行', '更新提示页强化版本号展示，评论入口改为“查看回复”', '修复部分内容区域滚轮操作不稳定'] },
        ],
      },
      {
        version: '1.6.0',
        date: '2026.07.30',
        type: '歌词引擎与编辑器升级',
        sections: [
          { title: '歌词解析全面升级', items: ['逐字 LRC 与 TTML 统一为明确的行、单元 begin/end 时间模型，相邻单元无缝共用时间边界', '修复英文空格、单字母、末尾单词瞬间染色、首行跳动与编辑预览不一致问题', '完善翻译、行结束时间以及 TTML xr-BG 背景人声解析'] },
          { title: '共唱、背景人声与动效', items: ['真正重叠的歌词支持同时演唱，首尾仅接触的两行不再误判为共唱', '背景人声在主句下方独立展开并原位收起，优化字号、翻译比例与消失动画', '修复共唱滚动抽搐、背景行错位与模糊更新延迟', '新增轻微放大效果，缩放还原与上移同步；快速歌词自动缩短行切换动画'] },
          { title: '元数据与歌词编辑器', items: ['重构歌曲信息与歌词编辑窗口，适配新布局、主题和 UI 材质', '完整展示逐字歌词、翻译、声道、背景人声及时间边界', '优化卡片层级、按钮位置、颜色区分、字号与滚动区域'] },
          { title: '界面与交互', items: ['歌词工具栏滑块浮层全区域支持滚轮操作', '歌词抬起幅度上限统一为 5px', '封面播放/暂停按钮出现首帧即呈现背景模糊', '播放列表、侧边栏选中滑块与三枚页面悬浮按钮完整适配四套 UI 材质'] },
          { title: '应用内更新修复', items: ['静默安装完成后自动重新打开新版', '新版启动时显式刷新主窗口图标，修复任务栏保留旧图标的问题'] },
        ],
      },
      {
        version: '1.5.2',
        date: '2026.07.30',
        type: '取色与界面优化',
        sections: [
          { title: '专辑封面取色设置', items: ['新增取色开关，可一键开启或关闭专辑封面取色功能，关闭后使用默认蓝色主题', '新增智能取色模式，根据当前主题（深色/浅色/灰色）自动适配最佳亮度，保证可读性', '新增手动调节模式，可自由调整取色深浅（-50 偏深 ~ +50 偏浅），拖动滑块实时预览'] },
          { title: '歌词面板修复', items: ['修复歌词面板无法进入的问题，清除内联 transform 样式让 CSS active 类正常生效', '歌词面板与控制栏弹出框不受 UI 缩放比例影响，始终保持原始尺寸'] },
          { title: '启动画面与图标优化', items: ['移除启动画面 logo 的阴影效果，呈现更简洁的视觉风格', '移除关于页面 logo 的阴影效果', 'GitHub 仓库主页 README 新增 KimoPlayer logo 图标展示'] },
        ],
      },
      {
        version: '1.5.1',
        date: '2026.07.29',
        type: '功能与体验优化',
        sections: [
          { title: '系统文件关联', items: ['安装后可在操作系统中双击音频文件直接使用播放器打开播放，支持 mp3、flac、wav、ogg、m4a、aac、wma、opus、ape、aiff 共 10 种格式', '应用已运行时双击文件自动追加到播放列表并播放，应用未运行时启动后自动加载'] },
          { title: '背景样式设置', items: ['新增三种背景模式：关闭背景、静态背景、动态背景', '动态背景模式下专辑封面以模糊旋转效果展示，可在设置中调节旋转速率（10%~100%）', '拖动滑块时暂停旋转，释放后立即生效'] },
          { title: 'UI 风格体系完善', items: ['新增四种 UI 风格：默认效果、亚克力、高斯模糊、液态玻璃，按视觉复杂度递增排列', '亚克力模式主内容区 60% 透明度 + 设置卡片 70% 透明度，呈现微妙层次感', '液态玻璃模式使用评论区同款材质参数，保留侧边栏与播放栏液态边框', '评论区窗口、右键菜单、Toast 提示全面适配四种 UI 风格', '深色主题下亚克力模式使用半透明黑色，浅色/灰色主题使用半透明白色'] },
          { title: '歌词弹出框重新设计', items: ['歌词控制栏滑块弹出框改为现代玻璃胶囊风格，增大模糊半径与饱和度', '滑块轨道新增进度填充效果，已调节部分以动态主题色高亮显示', '弹出框跟随歌词页面主题设置（深色/浅色/跟随软件），与右键菜单机制统一', '增大滑块圆点尺寸，优化悬停与拖动时的缩放反馈'] },
          { title: '滑块交互优化', items: ['所有设置页滑块与歌词弹出框滑块统一支持鼠标滚轮调整', '修复弹出框字号上限（36→48px）与抬起幅度上限（15→40px）未跟随设置页同步的问题', '动态背景旋转速率滑块滚轮调整后立即生效并恢复旋转'] },
          { title: '应用内更新功能', items: ['新增应用内更新检查器，自动从 GitHub Releases 获取最新版本', '支持优先选择 NSIS 安装包而非便携版', '测试版用户可输入密钥访问预发布版本', '更新下载进度实时显示，下载完成后一键安装'] },
        ],
      },
      {
        version: '1.5.0',
        date: '2026.07.28',
        type: '开源版本',
        sections: [
          { title: '开源发布', items: ['KimoPlayer 正式开源，源代码托管于 GitHub', '基于 Tauri + Rust + Vite 技术栈构建'] },
        ],
      },
      {
        version: '1.4.6-beta01',
        date: '2026.07.26',
        type: '右键菜单重构',
        sections: [
          { title: '右键菜单玻璃材质统一', items: ['所有右键菜单改为和评论区一致的玻璃材质（blur + 半透明背景）', '支持深色/浅色/灰色三套主题自动适配', '歌词界面右键菜单跟随歌词深浅色主题而非软件全局主题'] },
          { title: '歌词面板控制按钮', items: ['标题栏按钮、歌词控件按钮统一为玻璃材质', '歌词面板弹出框移到 body 下避免被 overflow: hidden 裁剪', '移除歌词面板内控制按钮的原生 tooltip（避免裁断）'] },
          { title: '右键菜单精简', items: ['移除空白区域默认右键菜单（含关闭播放器等）', '封面右键菜单仅在歌词页大封面触发', '播放器信息栏区域不再触发右键菜单'] },
          { title: '其他优化', items: ['评论搜索综合歌名+艺术家+专辑三维度匹配', '评论回复支持分页加载与展开/收起动画', '切歌时收藏按钮状态自动更新'] },
        ],
      },
      {
        version: '1.4.5',
        date: '2026.07.26',
        type: '优化与修复更新',
        sections: [
          { title: '评论搜索优化', items: ['改进评论搜索匹配算法，综合歌名、艺术家、专辑三维度匹配', '修复评论搜索匹配到错误歌曲的问题', '搜索结果同分时优先选专辑名短的（原版特征）'] },
          { title: '评论回复改进', items: ['网易云评论回复支持分页加载', '回复列表支持展开/收起动画', '回复按钮统一为纯文字样式'] },
          { title: '界面优化', items: ['禁用默认右键菜单，仅保留自定义菜单', '歌词界面艺术家跑马灯修复', '切歌时收藏按钮状态自动更新'] },
        ],
      },
      {
        version: '1.4.4',
        date: '2026.07.26',
        type: '功能与修复更新',
        sections: [
          { title: '系统托盘增强', items: ['关闭窗口最小化到托盘，双击托盘恢复窗口', '托盘菜单支持播放控制（上一首/播放暂停/下一首）', '托盘显示当前歌曲信息与播放状态', '托盘快速开关桌面歌词和打开设置'] },
          { title: '评论区大幅优化', items: ['切歌自动刷新评论面板', '支持加载更多评论与滚动自动加载', '新增评论回复查看（网易云）', '回复按点赞数排序，支持分页加载', '评论与回复显示 IP 属地（网易云）', '热门模式仅显示热评，最新模式过滤热评', '平台切换与排序切换自动滚回顶部'] },
          { title: '歌词界面优化', items: ['艺术家名称支持跑马灯自动滚动', '沉浸模式标题栏收起/展开添加过渡动画', '新增设置项：沉浸模式是否隐藏标题栏'] },
          { title: '其他修复', items: ['修复 QQ 音乐评论总数显示不正确', '修复评论按钮点击无法收起面板', '修复各平台评论回复总数计算错误', '优化设置页字体粗细层次'] },
        ],
      },
      {
        version: '1.4.3',
        date: '2026.07.25',
        type: '功能与优化更新',
        sections: [
          { title: '界面动画升级', items: ['页面切换、详情页进出、标签栏切换都加上了流畅的上浮渐现动画', '动画使用硬件加速，操作更丝滑'] },
          { title: '歌词页面主题设置', items: ['设置里新增歌词页面主题选项：深色 / 浅色 / 跟随软件'] },
          { title: '主页重新设计', items: ['增加月度听歌统计', '可看到最喜欢听的歌排行榜', '显示播放次数和播放时长'] },
          { title: '评论区背景效果优化', items: ['优化评论区背景效果，视觉体验更佳'] },
        ],
      },
      {
        version: '1.4.2',
        date: '2026.07.25',
        type: '功能与修复更新',
        sections: [
          { title: '音频质量标签', items: ['播放列表中的歌曲现在会显示音频质量标签（如 MP3、SQ、Hi-Res 等），方便快速识别音质', '可在设置中选择开启或关闭质量标签显示'] },
          { title: '播放器与格式兼容', items: ['修复 M4A (AAC) 等格式播放时进度条不动与无法拖拽跳转的问题', '优化音频时长获取机制，实现音轨精准播放同步'] },
          { title: '关于页面与弹窗体验', items: ['关于页面新增 Tauri、Rust、Vite、JS 框架小图标，直观展示技术栈', '新增「查看历史更新记录」模态框，并优化全软件弹窗关闭响应与平滑退场动画'] },
        ],
      },
      {
        version: '1.4.1',
        date: '2026.07.25',
        type: '优化更新',
        sections: [
          { title: '评论区优化', items: ['优化评论加载速度，体验更流畅', '优化评论获取逻辑，精准度更高', '优化评论区部分 UI 以及动效表现', '回复功能目前为测试状态，数据并非真实回复'] },
          { title: '主页面优化', items: ['优化主页面切换动效，切换更丝滑'] },
        ],
      },
      {
        version: '1.4.0',
        date: '2026.07.23',
        type: '新功能更新',
        sections: [
          { title: '多平台评论聚合', items: ['支持四大音乐平台评论：网易云音乐、QQ音乐、酷我音乐、酷狗音乐', '聚合展示：在评论面板中可同时查看不同平台的评论内容'] },
        ],
      },
      {
        version: '1.3.0',
        date: '2026.07.23',
        type: '正式版更新',
        sections: [
          { title: '歌词体验', items: ['歌词动效与逐字进度优化，迷你歌词切句同步更准确', '新增桌面歌词：支持透明显示、样式调整与鼠标穿透锁定'] },
          { title: '歌单与本地音乐', items: ['歌单添加支持多首歌曲；长按歌曲进入多选，单击即可选择或取消选择', '补全列表添加时的封面信息，并支持单击或双击播放设置'] },
          { title: '界面与个性化', items: ['新增界面字体选择与自定义字体导入，完善设置项动画与强调色统一', '本地音乐与搜索页优化为独立工具栏和列表滚动，主题配色同步统一'] },
          { title: '编辑与稳定性', items: ['新增独立元数据与歌词编辑窗口，并修复窗口控制、文件路径与保存状态问题', '优化音量控制布局与播放界面响应'] },
        ],
      },
      {
        version: '1.3.0-beta0722-03',
        date: '2026.07.22',
        type: '性能优化',
        sections: [
          { title: '性能与流畅度大幅提升', items: ['播放轻盈省电：优化后台渲染机制，主界面播放音乐时系统资源占用降低 90% 以上', '低功耗性能模式：在【系统设置 -> 歌词与视觉动效】中新增省电/性能模式，推荐集成显卡及笔记本用户开启', '歌词滚动更平滑：优化歌词渲染引擎，歌词滚动与字符动效更加自然丝滑'] },
          { title: '启动与视觉体验优化', items: ['无缝平滑启动：优化软件打开时的窗口呈现，告别界面启动边框与白色闪烁', '软件秒开无卡顿：优化资源后台加载顺序，软件打开响应更快、更轻便'] },
        ],
      },
      {
        version: '1.2.5',
        date: '2026.07.18',
        type: '功能更新',
        sections: [
          { title: '本次更新', items: ['迷你歌词新增逐字卡拉OK扫光效果，与全屏歌词同步', '迷你歌词支持显示翻译（可在设置面板开关）', '迷你歌词换行淡入淡出动画', '歌词面板工具栏自动折叠，点击齿轮图标展开所有设置', '启动时只允许运行单个实例，重复点击自动聚焦已有窗口', '修复音量条悬浮动画卡顿，过渡更流畅平滑', '优化窗口最小尺寸限制（820×560）'] },
        ],
      },
      {
        version: '1.2.0',
        date: '2026.07.10',
        type: '重大更新',
        sections: [
          { title: '侧边栏搜索', items: ['检索功能移至侧边栏，支持分类过滤，检索在后台 Web Worker 中执行以规避卡顿'] },
          { title: '动态模糊背景', items: ['背景替换为封面高斯模糊，支持 32s 缓慢旋转漂移，切歌时双图层 1.6s 渐变过渡'] },
          { title: '共唱歌词对齐', items: ['合唱等交叠歌词支持视口自动居中，优化滚动物理对冲，消除连续跳句时的抽搐抖动'] },
          { title: '底部栏逐字同步', items: ['底部歌词支持逐字染色，超长歌词取消省略号截断并支持自动折行'] },
          { title: 'TTML 解析与编辑', items: ['改用原生 DOMParser 解析以支持嵌套人声，时间轴编辑器支持 TTML 导入与保存'] },
          { title: '右键快捷菜单', items: ['封面支持右键查看/保存大图、修改元数据；歌词行支持右键定位跳转播放、复制文本'] },
          { title: '关于软件', items: ['设置页新增"关于软件"卡片，展示软件当前版本号及系统说明'] },
        ],
      },
    ];

    // 渲染历史更新弹窗
    const showChangelogModal = () => {
      const existing = document.getElementById('kimo-changelog-modal');
      if (existing) existing.remove();

      const itemsHTML = changelogData.map(release => {
        const sectionsHTML = release.sections.map(sec => {
          const listHTML = sec.items.map(it => `<div style="color:var(--text-secondary);font-size:12px;line-height:1.7;">• ${it}</div>`).join('');
          return `<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:2px;">${sec.title}</div>${listHTML}</div>`;
        }).join('');
        return `
          <div style="padding:14px 0;border-bottom:1px solid var(--glass-border);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span style="font-size:14px;font-weight:700;color:var(--text-primary);">v${release.version}</span>
              <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(16,185,129,0.15);color:rgb(16,185,129);">${release.type}</span>
              <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto;">${release.date}</span>
            </div>
            ${sectionsHTML}
          </div>
        `;
      }).join('');

      const overlay = document.createElement('div');
      overlay.id = 'kimo-changelog-modal';
      overlay.className = 'kimo-modal-overlay';
      overlay.innerHTML = `
        <div class="kimo-modal-card" style="max-width:480px;width:92%;max-height:70vh;padding:0;text-align:left;overflow:hidden;display:flex;flex-direction:column;">
          <div style="padding:18px 20px 14px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
            <div style="font-size:16px;font-weight:700;color:var(--text-primary);">历史更新记录</div>
            <button id="kimo-changelog-close" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;padding:4px;display:flex;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div style="padding:4px 20px 18px;overflow-y:auto;flex:1;">
            ${itemsHTML}
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const closeModal = () => {
        overlay.classList.add('is-closing');
        setTimeout(() => overlay.remove(), 200);
      };

      overlay.addEventListener('click', e => {
        if (e.target === overlay || e.target.closest('#kimo-changelog-close')) closeModal();
      });
    };

    // 绑定点击事件
    aboutCard.querySelector('#settings-changelog-btn').addEventListener('click', showChangelogModal);

    // GitHub 仓库链接
    const openGithub = () => {
      openUrl('https://github.com/kiomosu/KimoPlayer').catch(() => {
        window.open('https://github.com/kiomosu/KimoPlayer', '_blank');
      });
    };
    aboutCard.querySelector('#settings-github-link')?.addEventListener('click', openGithub);
    aboutCard.querySelector('#settings-github-text')?.addEventListener('click', openGithub);

    // 测试版密钥弹窗
    const showBetaKeyModal = (card) => {
      // 移除已有弹窗
      const existing = document.getElementById('kimo-beta-key-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'kimo-beta-key-modal';
      overlay.className = 'kimo-modal-overlay';
      overlay.innerHTML = `
        <div class="kimo-modal-card" style="max-width:360px;width:90%;padding:0;text-align:left;overflow:hidden;">
          <div style="padding:22px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(16,185,129)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
              <span style="font-size:16px;font-weight:700;color:var(--text-primary);">加入测试版</span>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">输入测试版密钥以解锁预览版本更新通道</div>
          </div>
          <div style="padding:20px 24px;">
            <input id="beta-key-input" type="password" placeholder="请输入密钥" autofocus style="width:100%;box-sizing:border-box;padding:10px 14px;font-size:13px;border:1px solid var(--glass-border);border-radius:8px;background:rgba(255,255,255,0.03);color:var(--text-primary);outline:none;transition:border-color 0.2s;" onfocus="this.style.borderColor='rgb(16,185,129)'" onblur="this.style.borderColor='var(--glass-border)'" />
            <div id="beta-key-error" style="display:none;margin-top:8px;font-size:11px;color:#f87171;">密钥无效，请重新输入</div>
          </div>
          <div style="padding:0 24px 20px;display:flex;gap:10px;">
            <button id="beta-key-cancel" style="flex:1;padding:10px;font-size:13px;font-weight:600;border:1px solid var(--glass-border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;">取消</button>
            <button id="beta-key-confirm" style="flex:1;padding:10px;font-size:13px;font-weight:600;border:none;border-radius:8px;background:rgb(16,185,129);color:#fff;cursor:pointer;">激活</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#beta-key-input');
      const errTip = overlay.querySelector('#beta-key-error');
      const close = () => overlay.remove();

      const confirm = () => {
        const key = input.value.trim();
        if (setBetaKey(key)) {
          // 更新按钮状态为"已加入测试"
          const betaBtn = card.querySelector('#settings-beta-btn');
          if (betaBtn) {
            betaBtn.style.background = 'rgba(16,185,129,0.1)';
            betaBtn.style.borderColor = 'rgba(16,185,129,0.3)';
            betaBtn.style.color = 'rgb(16,185,129)';
            const label = betaBtn.querySelector('span');
            if (label) label.textContent = '已加入测试';
          }
          showToast('已激活测试版更新通道');
          close();
        } else {
          errTip.style.display = 'block';
          input.value = '';
          input.focus();
        }
      };

      overlay.querySelector('#beta-key-cancel').addEventListener('click', close);
      overlay.querySelector('#beta-key-confirm').addEventListener('click', confirm);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirm();
        if (e.key === 'Escape') close();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      // 隐藏错误提示当用户重新输入
      input.addEventListener('input', () => { errTip.style.display = 'none'; });
      setTimeout(() => input.focus(), 50);
    };

    // 检查更新 — 按钮带加载动画
    aboutCard.querySelector('#settings-check-update-btn')?.addEventListener('click', async () => {
      const btn = aboutCard.querySelector('#settings-check-update-btn');
      const textEl = aboutCard.querySelector('#check-update-text');
      const iconEl = aboutCard.querySelector('#check-update-icon');
      const origText = textEl.textContent;

      // 切换到加载状态
      btn.disabled = true;
      btn.style.opacity = '0.6';
      textEl.textContent = '检查中...';
      iconEl.outerHTML = '<svg id="check-update-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" style="animation:kimo-btn-spin 0.8s linear infinite;"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40 20" stroke-linecap="round"/></svg>';

      try {
        const result = await checkForUpdates(true);
        if (result) {
          // 找到更新，弹窗已由 checkForUpdates 内部弹出
          resetBtn();
        } else {
          textEl.textContent = '已是最新';
          setTimeout(resetBtn, 2000);
        }
      } catch (err) {
        textEl.textContent = '检查失败';
        setTimeout(resetBtn, 2000);
        showToast('检查更新失败，请检查网络连接');
      }

      function resetBtn() {
        btn.disabled = false;
        btn.style.opacity = '1';
        textEl.textContent = origText;
        const cur = aboutCard.querySelector('#check-update-icon');
        if (cur) cur.outerHTML = '<svg id="check-update-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      }
    });

    // 加入测试 — 弹窗输入密钥
    aboutCard.querySelector('#settings-beta-btn')?.addEventListener('click', () => {
      if (getBetaStatus()) {
        showToast('已激活测试版更新通道');
        return;
      }
      showBetaKeyModal(aboutCard);
    });

    // 挂载设置面板容器至 DOM
    listEl.appendChild(container);

    lyricCard.querySelectorAll('#settings-lyrics-theme-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        lyricCard.querySelectorAll('#settings-lyrics-theme-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        lyricCard.querySelector('#settings-lyrics-theme-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-lyrics-theme', val);
        if (typeof applyLyricsTheme === 'function') {
          applyLyricsTheme(val);
        }
        showToast(`歌词页面主题已切换为: ${val === 'follow' ? '自动' : (val === 'light' ? '浅色' : '深色')}`);
      });
    });

    lyricCard.querySelectorAll('#settings-stagger-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        lyricCard.querySelectorAll('#settings-stagger-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        lyricCard.querySelector('#settings-stagger-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        // ⭐ 修复：使用与 toggleStaggerMode 一致的 localStorage key，并触发 render + realign 让模式真正生效⭐
        localStorage.setItem('kimo-lyrics-stagger-mode', val);
        if (player && player.lyrics) {
          player.lyrics.lyricsStaggerMode = val;
          player.lyrics.updateStaggerUI();
          player.lyrics.render();
          if (player.lyrics.isVisible) {
            player.lyrics.realign();
            if (player.audio) {
              player.lyrics.syncToTime(player.audio.currentTime);
            }
          }
        }
        showToast(`已切换为: ${val === 'stagger' ? '字母依次上移' : '单词整体上移'}`);
      });
    });

    lyricCard.querySelector('#settings-mini-translation').addEventListener('change', (e) => {
      localStorage.setItem('kimo-mini-lyrics-show-translation', e.target.checked);
      applyMiniLyricsTranslationSetting();
      showToast(`已${e.target.checked ? '开启' : '关闭'}迷你歌词翻译`);
    });

    // 迷你歌词字号滑块
    const miniLyricsSizeSlider = lyricCard.querySelector('#settings-mini-lyrics-size');
    const miniLyricsSizeVal = lyricCard.querySelector('#mini-lyrics-size-val');
    const applyMiniLyricsSize = (size) => {
      const clamped = Math.max(11, Math.min(18, size));
      document.documentElement.style.setProperty('--mini-lyrics-size', `${clamped.toFixed(1)}px`);
      if (miniLyricsSizeSlider) miniLyricsSizeSlider.value = clamped;
      if (miniLyricsSizeVal) miniLyricsSizeVal.textContent = `${clamped.toFixed(1)}px`;
    };
    if (miniLyricsSizeSlider) {
      miniLyricsSizeSlider.addEventListener('input', (e) => {
        applyMiniLyricsSize(parseFloat(e.target.value));
      });
      miniLyricsSizeSlider.addEventListener('change', (e) => {
        const val = Math.max(11, Math.min(18, parseFloat(e.target.value)));
        localStorage.setItem('kimo-mini-lyrics-font-size', val);
      });
      // 滚轮支持
      miniLyricsSizeSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.5 : -0.5;
        const current = parseFloat(miniLyricsSizeSlider.value);
        const next = Math.max(11, Math.min(18, current + delta));
        miniLyricsSizeSlider.value = next;
        applyMiniLyricsSize(next);
        localStorage.setItem('kimo-mini-lyrics-font-size', next);
      }, { passive: false });
    }

    lyricCard.querySelector('#settings-lyrics-filter-info')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      updateLyricsPreference('filterInfoEnabled', enabled);

      if (player?.lyrics?.audioPath) {
        await player.lyrics.load(player.lyrics.audioPath);
        if (player.audio) {
          player.lyrics.syncToTime(player.audio.currentTime);
        }
      }

      showToast(enabled ? '已过滤歌词中的歌曲信息' : '已显示完整歌词信息');
    });

    const syncDesktopLyricsStyle = () => {
      const sizeVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-size')?.value || 34;
      const opacityVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-opacity')?.value || 0.96;
      const transVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-translation')?.checked;
      const wordByWordVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-word-by-word')?.checked;
      const glowVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-glow')?.checked;
      const strokeVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-stroke')?.checked;
      const themeVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-theme')?.value;
      const alignVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-align')?.value;

      const sizeDisplay = desktopLyricCard.querySelector('#desktop-lyrics-size-val');
      if (sizeDisplay) sizeDisplay.textContent = `${sizeVal}px`;

      const opacityDisplay = desktopLyricCard.querySelector('#desktop-lyrics-opacity-val');
      if (opacityDisplay) opacityDisplay.textContent = `${Math.round(opacityVal * 100)}%`;

      localStorage.setItem('kimo-desktop-lyrics-font-size', sizeVal);
      localStorage.setItem('kimo-desktop-lyrics-opacity', opacityVal);
      localStorage.setItem('kimo-desktop-lyrics-show-translation', transVal ? 'true' : 'false');
      localStorage.setItem('kimo-desktop-lyrics-word-by-word', wordByWordVal ? 'true' : 'false');
      localStorage.setItem('kimo-desktop-lyrics-glow', glowVal ? 'true' : 'false');
      localStorage.setItem('kimo-desktop-lyrics-stroke', strokeVal ? 'true' : 'false');
      if (themeVal) localStorage.setItem('kimo-desktop-lyrics-theme', themeVal);
      if (alignVal) localStorage.setItem('kimo-desktop-lyrics-align', alignVal);
      desktopLyrics?.updateStyle();
      // 同步刷新设置页实时预览（此前缺失，导致部分设置项修改后预览不更新）
      updateDesktopLyricsPreview();
    };

    desktopLyricCard.querySelector('#settings-desktop-lyrics-size')?.addEventListener('input', syncDesktopLyricsStyle);
    desktopLyricCard.querySelector('#settings-desktop-lyrics-opacity')?.addEventListener('input', syncDesktopLyricsStyle);

    desktopLyricCard.querySelector('#settings-desktop-lyrics-line-mode-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.setting-radio-btn');
      if (!btn) return;
      const val = btn.dataset.val;
      const group = desktopLyricCard.querySelector('#settings-desktop-lyrics-line-mode-group');
      if (group) {
        group.setAttribute('data-active-idx', val === 'double' ? '1' : '0');
        group.querySelectorAll('.setting-radio-btn').forEach(b => b.classList.toggle('active', b === btn));
      }
      localStorage.setItem('kimo-desktop-lyrics-line-mode', val);
      // 双行排列选项仅在双行模式显示
      const layoutRow = desktopLyricCard.querySelector('#settings-desktop-lyrics-layout-row');
      if (layoutRow) toggleSettingRow(layoutRow, val === 'double');
      const alignRow = desktopLyricCard.querySelector('#settings-desktop-lyrics-align-row');
      if (alignRow) toggleSettingRow(alignRow, val !== 'double');
      desktopLyrics?.updateStyle();
    });

    // 双行排列：上下 / 左右
    desktopLyricCard.querySelector('#settings-desktop-lyrics-layout-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.setting-radio-btn');
      if (!btn) return;
      const val = btn.dataset.val;
      const group = desktopLyricCard.querySelector('#settings-desktop-lyrics-layout-group');
      if (group) {
        group.setAttribute('data-active-idx', val === 'split' ? '1' : '0');
        group.querySelectorAll('.setting-radio-btn').forEach(b => b.classList.toggle('active', b === btn));
      }
      localStorage.setItem('kimo-desktop-lyrics-layout', val);
      desktopLyrics?.updateStyle();
      showToast(`双行排列: ${val === 'split' ? '左右分栏' : '上下排列'}`);
    });

    // 桌面歌词字号滑块滚轮支持
    desktopLyricCard.querySelector('#settings-desktop-lyrics-size')?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const slider = e.target;
      const delta = e.deltaY < 0 ? 1 : -1;
      const nextVal = Math.max(12, Math.min(56, parseInt(slider.value) + delta));
      slider.value = nextVal;
      syncDesktopLyricsStyle();
    }, { passive: false });

    // 桌面歌词透明度滑块滚轮支持
    desktopLyricCard.querySelector('#settings-desktop-lyrics-opacity')?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const slider = e.target;
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const nextVal = Math.max(0.25, Math.min(1, parseFloat(slider.value) + delta));
      slider.value = nextVal;
      syncDesktopLyricsStyle();
    }, { passive: false });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-word-by-word')?.addEventListener('change', (e) => {
      syncDesktopLyricsStyle();
      showToast(`桌面歌词逐字动画: ${e.target.checked ? '开启' : '关闭'}`);
    });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-translation')?.addEventListener('change', syncDesktopLyricsStyle);
    desktopLyricCard.querySelector('#settings-desktop-lyrics-glow')?.addEventListener('change', (e) => {
      syncDesktopLyricsStyle();
      showToast(`字体阴影发光: ${e.target.checked ? '开启' : '关闭'}`);
    });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-stroke')?.addEventListener('change', (e) => {
      syncDesktopLyricsStyle();
      showToast(`字体防瞎描边: ${e.target.checked ? '开启' : '关闭'}`);
    });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-theme')?.addEventListener('change', syncDesktopLyricsStyle);
    desktopLyricCard.querySelector('#settings-desktop-lyrics-align')?.addEventListener('change', syncDesktopLyricsStyle);

    desktopLyricCard.querySelector('#settings-desktop-lyrics-locked')?.addEventListener('change', event => {
      const locked = event.target.checked;
      localStorage.setItem('kimo-desktop-lyrics-locked', locked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      showToast(locked ? '桌面歌词已锁定(穿透)' : '桌面歌词已解除锁定');
    });

    desktopLyricCard.querySelector('#settings-immersive-hide-titlebar')?.addEventListener('change', event => {
      const hide = event.target.checked;
      localStorage.setItem('kimo-immersive-hide-titlebar', hide ? 'true' : 'false');
      showToast(hide ? '沉浸模式将隐藏标题栏' : '沉浸模式将显示标题栏');
    });

    lyricCard.querySelector('#settings-lyrics-row-follow')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      updateLyricsPreference('rowFollowEnabled', enabled);
      showToast(`已${enabled ? '开启' : '关闭'}歌词逐行跟随动画`);
    });

    const perfCheckbox = perfCard.querySelector('#settings-perf-mode');
    perfCheckbox?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('kimo-performance-mode', enabled ? 'true' : 'false');
      document.body.classList.toggle('perf-mode', enabled);
      if (player && player.lyrics) {
        player.lyrics.clearBlur();
        if (player.lyrics.isVisible && player.audio) {
          player.lyrics.syncToTime(player.audio.currentTime);
        }
      }
      showToast(`已${enabled ? '开启低功耗性能模式 (Intel 集显优化)' : '关闭低功耗性能模式'}`);
    });

        // 主题分段钮组事件监听
    themeCard.querySelectorAll('#settings-theme-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-theme-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-theme-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        const isCustom = localStorage.getItem('kimo-overlay-opacity-custom') === 'true';
        const op = isCustom ? localStorage.getItem('kimo-overlay-opacity') : null;
        applyTheme(val, op);
        showToast(`已切换至: ${val === 'light' ? '浅色遮罩主题' : (val === 'grey' ? '雅致灰色主题' : '深色遮罩主题')}`);
      });
    });

    // 歌词页面主题分段钮组事件监听
    themeCard.querySelectorAll('#settings-lyrics-theme-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-lyrics-theme-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-lyrics-theme-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-lyrics-theme', val);
        applyLyricsTheme(val);
        showToast(`歌词页面主题已切换至: ${val === 'follow' ? '自动' : (val === 'light' ? '浅色' : '深色')}`);
      });
    });

    // UI 风格分段钮组事件监听
    themeCard.querySelectorAll('#settings-ui-style-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-ui-style-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-ui-style-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-ui-style', val);
        applyUiStyle(val);
        const styleNames = { acrylic: '亚克力', gaussian: '高斯模糊', liquid: '液态玻璃', solid: '默认效果' };
        showToast(`UI 风格已切换至: ${styleNames[val] || val}`);
      });
    });

    // 界面动画速率分段钮组事件监听
    themeCard.querySelectorAll('#settings-anim-speed-group .setting-radio-btn')?.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-anim-speed-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-anim-speed-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-anim-speed', val);
        document.documentElement.setAttribute('data-anim-speed', val);
        const speedNames = { slow: '舒缓平滑', fast: '极速敏捷', none: '关闭动画' };
        showToast(`界面动画速率已切换至: ${speedNames[val] || val}`);
      });
    });

    // 背景样式分段钮组事件监听
    themeCard.querySelectorAll('#settings-bg-style-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-bg-style-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-bg-style-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-bg-style', val);
        applyBackgroundStyle(val);
        // 显示/隐藏旋转速率滑块、自定义背景设置区与背景遮罩滑块（按背景样式适配）
        const speedRow = themeCard.querySelector('#settings-bg-rotate-speed-row');
        if (speedRow) toggleSettingRow(speedRow, val === 'dynamic');
        const overlayRow = themeCard.querySelector('#settings-overlay-opacity-row');
        if (overlayRow) toggleSettingRow(overlayRow, val === 'static' || val === 'dynamic');
        const isCustom = val === 'custom';
        ['#settings-bg-custom-mask-row', '#settings-bg-custom-pick-row'].forEach(sel => {
          const row = themeCard.querySelector(sel);
          if (row) toggleSettingRow(row, isCustom);
        });
        const bgNames = { none: '关闭背景', static: '静态背景', dynamic: '动态背景', custom: '自定义背景' };
        showToast(`背景样式已切换至: ${bgNames[val] || val}`);
      });
    });

    // 自定义背景：遮罩开关（关闭后图片原样直出）
    themeCard.querySelector('#settings-bg-mask-enabled')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-bg-mask-enabled', e.target.checked ? 'true' : 'false');
      applyBackgroundStyle('custom');
      showToast(e.target.checked ? '背景遮罩已开启' : '背景遮罩已关闭，图片原样直出');
    });

    // 自定义背景：选择图片
    themeCard.querySelector('#settings-bg-custom-pick')?.addEventListener('click', async () => {
      try {
        const selected = await open({
          title: '选择背景图片',
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
        });
        if (!selected) return;
        const filePath = typeof selected === 'string' ? selected : selected.path;
        localStorage.setItem('kimo-custom-bg-path', filePath);
        const nameEl = themeCard.querySelector('#settings-bg-custom-name');
        if (nameEl) nameEl.textContent = filePath.split(/[\\/]/).pop();
        applyBackgroundStyle('custom');
        showToast('自定义背景已应用');
      } catch (e) {
        console.error('[CustomBg] Failed to pick image:', e);
        showToast('选择图片失败');
      }
    });

    // 窗口透明度（0% = 整窗口全透明透出桌面；作用于整个窗口，与背景设置无关）
    themeCard.querySelector('#settings-slider-window-opacity')?.addEventListener('input', (e) => {
      const v = e.target.value;
      const valEl = themeCard.querySelector('#settings-window-opacity-val');
      if (valEl) valEl.textContent = `${v}%`;
      localStorage.setItem('kimo-window-opacity', String(v));
      // 材质层与窗口透明互斥：调到透明时自动关闭材质引擎预览，再应用用户新值
      if (parseFloat(v) < 100 && window.__materialEngine?.previewActive) {
        localStorage.setItem('kimo-material-engine-preview', 'false');
        window.__materialEngine.setPreview(false);
        const toggle = themeCard.querySelector('#settings-material-engine-preview');
        if (toggle) toggle.checked = false;
        showToast('窗口透明与材质层互斥，已自动关闭材质引擎');
        // setPreview(false) 会恢复被强制的不透明度——这里重新写回用户新值，保证存储与显示一致
        localStorage.setItem('kimo-window-opacity', String(v));
      }
      applyWindowOpacity(parseFloat(v));
    });

    // 窗口材质：Windows 系统级底座（DWM 模糊窗口后真实内容）
    themeCard.querySelectorAll('#settings-window-material-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-window-material-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-window-material-group').setAttribute('data-active-idx', idx.toString());
        const val = btn.getAttribute('data-val');
        localStorage.setItem('kimo-window-material', val);
        // 互斥：材质预览开着时选「无」→ 自动关闭预览（避免叠加层悬空）
        if (val === 'none' && window.__materialEngine?.previewActive) {
          localStorage.setItem('kimo-material-engine-preview', 'false');
          window.__materialEngine.setPreview(false);
          const toggle = themeCard.querySelector('#settings-material-engine-preview');
          if (toggle) toggle.checked = false;
          showToast('窗口材质已切换为: 无（材质引擎预览已关闭）');
          return;
        }
        applyWindowMaterial(val);
        const materialNames = { none: '无', acrylic: '亚克力', mica: '云母', blur: '模糊' };
        showToast(`窗口材质已切换为: ${materialNames[val] || val}`);
      });
    });

    // 材质引擎预览（实验）：开启后引擎接管背景层渲染玻璃效果
    themeCard.querySelector('#settings-material-engine-preview')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-material-engine-preview', e.target.checked ? 'true' : 'false');
      window.__materialEngine?.setPreview?.(e.target.checked);
      showToast(e.target.checked ? '材质引擎已启用（实验）' : '材质引擎已关闭');
    });

    // 动态背景旋转速率滑块
    const bgRotateSpeedSlider = themeCard.querySelector('#settings-slider-bg-rotate-speed');
    if (bgRotateSpeedSlider) {
      // 拖动时：暂停旋转，仅更新百分比显示
      bgRotateSpeedSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const display = themeCard.querySelector('#settings-bg-rotate-speed-val');
        if (display) display.textContent = `${val}%`;
        // 暂停旋转动画
        document.documentElement.style.setProperty('--bg-rotate-play-state', 'paused');
      });
      // 释放后：保存设置，恢复旋转并应用新速率
      bgRotateSpeedSlider.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        localStorage.setItem('kimo-bg-rotate-speed', String(val));
        // 百分比转持续时长：100% → 10s, 50% → 20s, 10% → 100s
        const duration = Math.round(1000 / val);
        document.documentElement.style.setProperty('--bg-rotate-duration', `${duration}s`);
        // 恢复旋转动画
        document.documentElement.style.setProperty('--bg-rotate-play-state', 'running');
      });

      // 滚轮支持
      bgRotateSpeedSlider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 5 : -5;
        const nextVal = Math.max(10, Math.min(100, parseInt(bgRotateSpeedSlider.value) + delta));
        bgRotateSpeedSlider.value = nextVal;
        const display = themeCard.querySelector('#settings-bg-rotate-speed-val');
        if (display) display.textContent = `${nextVal}%`;
        // 立即应用并恢复旋转
        localStorage.setItem('kimo-bg-rotate-speed', String(nextVal));
        const duration = Math.round(1000 / nextVal);
        document.documentElement.style.setProperty('--bg-rotate-duration', `${duration}s`);
        document.documentElement.style.setProperty('--bg-rotate-play-state', 'running');
      }, { passive: false });
    }

    const interfaceFontSelect = themeCard.querySelector('#settings-interface-font');
    const customFontFile = themeCard.querySelector('#settings-custom-font-file');
    let currentFontMode = getStoredInterfaceFont().mode;

    const chooseCustomFont = async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{
            name: '字体文件',
            extensions: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
          }],
        });
        if (!selected) return false;

        const entry = await addUserFont(selected);
        await applyInterfaceFont(`user:${selected}`);
        currentFontMode = `user:${selected}`;
        interfaceFontSelect.value = `user:${selected}`;
        customFontFile.textContent = getFontFileName(selected);
        customFontFile.title = selected;
        showToast(`已添加并应用字体「${entry.name}」`);
        renderUserFontList();
        refreshFontSelects();
        return true;
      } catch (error) {
        console.error('[InterfaceFont] Failed to apply custom font:', error);
        showToast('字体文件无法加载，请尝试其他字体');
        return false;
      }
    };

    // ─── 字体管理弹窗：我的字体（可删）+ 推荐字体（下载）───
    const renderUserFontList = () => {
      const userFontList = document.getElementById('settings-user-font-list');
      if (!userFontList) return;
      const fonts = getUserFonts();
      if (!fonts.length) {
        userFontList.innerHTML = '<div class="setting-font-empty">暂无，可点击「添加字体」或从下方「推荐字体」下载</div>';
        return;
      }
      userFontList.innerHTML = fonts.map(font => `
        <div class="setting-user-font-item">
          <span class="setting-user-font-name" title="${font.path}">${font.name}</span>
          <button class="setting-font-remove-btn" data-font-path="${font.path.replace(/"/g, '&quot;')}">删除</button>
        </div>
      `).join('');
    };

    // ─── 推荐字体列表渲染（应用内下载 + 进度；已安装的不再显示）───
    const renderDownloadableFontList = () => {
      const downloadableFontList = document.getElementById('settings-downloadable-font-list');
      if (!downloadableFontList) return;
      const installed = new Set(getUserFonts().map(f => f.path.split(/[\\/]/).pop()));
      // auto 条目（默认字体）由首次启动自动下载，不出现在推荐列表
      const list = DOWNLOADABLE_FONTS.filter(font => !font.auto && !installed.has(font.filename));
      if (!list.length) {
        downloadableFontList.innerHTML = '<div class="setting-font-empty">推荐字体已全部安装</div>';
        return;
      }
      downloadableFontList.innerHTML = list.map(font => `
        <div class="setting-downloadable-font-item" data-font-name="${font.name}" data-font-filename="${font.filename}">
          <div class="setting-downloadable-font-info">
            <div class="setting-downloadable-font-name">${font.name}</div>
            <div class="setting-downloadable-font-desc">${font.description}</div>
          </div>
          <div class="setting-font-progress hidden">
            <div class="setting-font-progress-bar"></div>
          </div>
          <div class="setting-downloadable-font-action">
            <button class="setting-btn setting-font-download-btn">下载</button>
          </div>
        </div>
      `).join('');
    };

    // 重建三个字体下拉（添加/删除用户字体后同步 options）
    const refreshFontSelects = () => {
      const rebuild = (select, options, currentValue) => {
        if (!select) return;
        select.innerHTML = options.map(opt =>
          `<option value="${opt.value}" ${currentValue === opt.value ? 'selected' : ''}>${opt.label}</option>`
        ).join('') + '<option value="custom">自定义字体</option>';
      };
      rebuild(interfaceFontSelect, getFontOptions(), currentFontMode);
      rebuild(lyricsFontSelect, getFontOptions(true), currentLyricsFontMode);
      rebuild(desktopLyricsFontSelect, getFontOptions(true), currentDesktopFontMode);
    };

    const openFontManager = () => {
      const existing = document.getElementById('kimo-font-manager-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'kimo-font-manager-modal';
      overlay.className = 'kimo-modal-overlay';
      overlay.innerHTML = `
        <div class="kimo-modal-card" style="max-width:520px;width:92%;max-height:78vh;padding:0;text-align:left;overflow:hidden;display:flex;flex-direction:column;">
          <div class="kimo-modal-header">
            <div class="kimo-modal-title">字体管理</div>
            <button class="kimo-modal-close" data-font-manager-close title="关闭">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="kimo-modal-body">
            <div class="font-manager-section">
              <div class="font-manager-section-title">我的字体 <span class="font-manager-section-hint">内置字体不可删除</span></div>
              <div class="font-manager-add-row">
                <button class="setting-btn" id="settings-font-add-btn">+ 添加字体</button>
              </div>
              <div class="setting-user-fonts" id="settings-user-font-list"></div>
            </div>
            <div class="font-manager-section">
              <div class="font-manager-section-title">推荐字体 <span class="font-manager-section-hint">开源免费，应用内下载</span></div>
              <div class="setting-downloadable-fonts" id="settings-downloadable-font-list"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      renderUserFontList();
      renderDownloadableFontList();

      overlay.querySelector('[data-font-manager-close]')?.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('#settings-font-add-btn')?.addEventListener('click', chooseCustomFont);
      overlay.querySelector('#settings-user-font-list')?.addEventListener('click', onRemoveFont);
      overlay.querySelector('#settings-downloadable-font-list')?.addEventListener('click', onDownloadFont);
    };

    // 用户字体删除（事件委托：内置字体不在列表，天然不可删）
    const onRemoveFont = async (event) => {
      const btn = event.target.closest('.setting-font-remove-btn');
      if (!btn) return;
      const path = btn.dataset.fontPath;
      const removed = await removeUserFont(path);
      if (removed) {
        showToast('已删除字体');
        currentFontMode = getStoredInterfaceFont().mode;
        interfaceFontSelect.value = currentFontMode;
        renderUserFontList();
        renderDownloadableFontList();
        refreshFontSelects();
        applyStoredLyricsFont();
        desktopLyrics?.updateStyle();
        updateDesktopLyricsPreview();
      }
    };

    // 推荐字体下载（进度展示）
    const onDownloadFont = async (event) => {
      const btn = event.target.closest('.setting-font-download-btn');
      if (!btn) return;
      const item = btn.closest('.setting-downloadable-font-item');
      const fontInfo = DOWNLOADABLE_FONTS.find(f => f.name === item.dataset.fontName);
      if (!fontInfo || btn.disabled) return;

      btn.disabled = true;
      btn.textContent = '下载中…';
      const progressBox = item.querySelector('.setting-font-progress');
      const progressBar = item.querySelector('.setting-font-progress-bar');
      progressBox?.classList.remove('hidden');

      try {
        const targetPath = await downloadFont(fontInfo, (progress) => {
          const percent = Math.min(100, Math.round(progress.percent || 0));
          if (progressBar) progressBar.style.width = `${percent}%`;
        });
        progressBar?.style && (progressBar.style.width = '100%');
        const entry = getUserFonts().find(f => f.path === targetPath) || { name: fontInfo.name };
        showToast(`字体「${entry.name}」下载完成，已加入「我的字体」`);
        renderUserFontList();
        renderDownloadableFontList();
        refreshFontSelects();
      } catch (error) {
        console.error('[InterfaceFont] 字体下载失败：', error);
        showToast(`字体下载失败：${error?.message || '网络异常，请重试'}`);
        progressBox?.classList.add('hidden');
        btn.disabled = false;
        btn.textContent = '重试';
      }
    };

    interfaceFontSelect?.addEventListener('change', async (event) => {
      const nextMode = event.target.value;
      if (nextMode === 'custom') {
        const storedFont = getStoredInterfaceFont();
        if (storedFont.customPath) {
          try {
            await applyInterfaceFont('custom', storedFont.customPath);
            currentFontMode = 'custom';
            showToast('已切换至自定义界面字体');
            return;
          } catch (error) {
            console.warn('[InterfaceFont] Saved custom font is unavailable:', error);
          }
        }

        const applied = await chooseCustomFont();
        if (!applied) event.target.value = currentFontMode;
        return;
      }

      await applyInterfaceFont(nextMode);
      currentFontMode = nextMode;
      const preset = INTERFACE_FONT_PRESETS.find(item => item.value === nextMode);
      const userFont = nextMode.startsWith('user:') ? getUserFonts().find(f => f.path === nextMode.slice(5)) : null;
      showToast(`已切换至${userFont?.name || preset?.label || '默认字体'}`);
      applyStoredLyricsFont();
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    themeCard.querySelector('#settings-font-manage-btn')?.addEventListener('click', openFontManager);

    // ════ 歌词页面字体控制事件 ════
    const lyricsFontSelect = lyricCard.querySelector('#settings-lyrics-font');
    const customLyricsFontBtn = lyricCard.querySelector('#settings-custom-lyrics-font-btn');
    const customLyricsFontFile = lyricCard.querySelector('#settings-custom-lyrics-font-file');
    let currentLyricsFontMode = getStoredLyricsFont().mode;

    const chooseCustomLyricsFont = async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{
            name: '字体文件',
            extensions: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
          }],
        });
        if (!selected) return false;

        const entry = await addUserFont(selected);
        await applyLyricsFont(`user:${selected}`);
        currentLyricsFontMode = `user:${selected}`;
        if (lyricsFontSelect) lyricsFontSelect.value = `user:${selected}`;
        if (customLyricsFontFile) {
          customLyricsFontFile.textContent = getFontFileName(selected);
          customLyricsFontFile.title = selected;
        }
        showToast(`已添加并应用歌词字体「${entry.name}」`);
        renderUserFontList();
        refreshFontSelects();
        return true;      } catch (error) {
        console.error('[LyricsFont] Failed to apply custom lyrics font:', error);
        showToast('字体文件无法加载，请尝试其他字体');
        return false;
      }
    };

    lyricsFontSelect?.addEventListener('change', async (event) => {
      const nextMode = event.target.value;
      if (nextMode === 'custom') {
        const storedFont = getStoredLyricsFont();
        if (storedFont.customPath) {
          try {
            await applyLyricsFont('custom', storedFont.customPath);
            currentLyricsFontMode = 'custom';
            showToast('已切换至自定义歌词页面字体');
            return;
          } catch (error) {
            console.warn('[LyricsFont] Saved custom font is unavailable:', error);
          }
        }

        const applied = await chooseCustomLyricsFont();
        if (!applied) event.target.value = currentLyricsFontMode;
        return;
      }

      await applyLyricsFont(nextMode);
      currentLyricsFontMode = nextMode;
      const preset = getFontOptions(true).find(item => item.value === nextMode);
      const userFont = nextMode.startsWith('user:') ? getUserFonts().find(f => f.path === nextMode.slice(5)) : null;
      showToast(`已切换至${userFont?.name || preset?.label || '默认歌词字体'}`);
    });

    customLyricsFontBtn?.addEventListener('click', chooseCustomLyricsFont);

    // ════ 🖥️ 桌面歌词预览与控件联动事件 ════
    const desktopLyricsFontSelect = desktopLyricCard.querySelector('#settings-desktop-lyrics-font');
    const customDesktopFontBtn = desktopLyricCard.querySelector('#settings-custom-desktop-font-btn');
    const customDesktopFontFile = desktopLyricCard.querySelector('#settings-custom-desktop-font-file');
    let currentDesktopFontMode = getStoredDesktopLyricsFont().mode;
    const previewLoadedFontMap = new Map();

    const updateDesktopLyricsPreview = async () => {
      const previewBox = desktopLyricCard.querySelector('#desktop-lyrics-preview-box');
      const previewViewport = desktopLyricCard.querySelector('#desktop-lyrics-preview-viewport');
      const previewMain = desktopLyricCard.querySelector('#desktop-lyrics-preview-main');
      const previewSub = desktopLyricCard.querySelector('#desktop-lyrics-preview-sub');
      if (!previewBox || !previewViewport || !previewMain || !previewSub) return;

      const size = Number(desktopLyricCard.querySelector('#settings-desktop-lyrics-size')?.value || 34);
      const opacity = Number(desktopLyricCard.querySelector('#settings-desktop-lyrics-opacity')?.value || 0.96);
      const theme = desktopLyricCard.querySelector('#settings-desktop-lyrics-theme')?.value || 'aurora';
      const align = desktopLyricCard.querySelector('#settings-desktop-lyrics-align')?.value || 'center';
      const showTranslation = desktopLyricCard.querySelector('#settings-desktop-lyrics-translation')?.checked !== false;
      const wordByWord = desktopLyricCard.querySelector('#settings-desktop-lyrics-word-by-word')?.checked !== false;
      const glow = desktopLyricCard.querySelector('#settings-desktop-lyrics-glow')?.checked !== false;
      const stroke = desktopLyricCard.querySelector('#settings-desktop-lyrics-stroke')?.checked !== false;

      const fontSelectVal = desktopLyricsFontSelect?.value || 'follow';
      const storedFont = getStoredDesktopLyricsFont();
      const fontFamily = resolveDesktopLyricsFontFamily(fontSelectVal, storedFont.customPath);

      previewBox.style.setProperty('--preview-size', `${size}px`);
      previewBox.style.opacity = opacity;
      previewBox.setAttribute('data-theme', theme);
      previewBox.setAttribute('data-glow', glow ? 'true' : 'false');
      previewBox.setAttribute('data-stroke', stroke ? 'true' : 'false');
      previewViewport.setAttribute('data-align', align);

      // 自定义歌词颜色（已播放 / 未播放）同步到预览
      const customColorEnabled = desktopLyricCard.querySelector('#settings-desktop-lyrics-custom-color')?.checked === true;
      const activeColorVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-color-active')?.value || '';
      const inactiveColorVal = desktopLyricCard.querySelector('#settings-desktop-lyrics-color-inactive')?.value || '';
      previewBox.setAttribute('data-custom-color', customColorEnabled ? 'true' : 'false');
      if (customColorEnabled) {
        if (activeColorVal) previewBox.style.setProperty('--theme-accent', activeColorVal);
        if (inactiveColorVal) previewBox.style.setProperty('--unfilled-color', inactiveColorVal);
      } else {
        previewBox.style.removeProperty('--theme-accent');
        previewBox.style.removeProperty('--unfilled-color');
      }

      const targetFont = (fontSelectVal === 'custom' && storedFont.customPath)
        ? `'KimoDesktopLyricsPreviewCustom', system-ui, "Microsoft YaHei UI", sans-serif`
        : fontFamily;

      if (fontSelectVal === 'custom' && storedFont.customPath) {
        if (!previewLoadedFontMap.has(storedFont.customPath)) {
          try {
            const sourceUrl = convertFileSrc(storedFont.customPath);
            const nextFontFace = new FontFace('KimoDesktopLyricsPreviewCustom', `url(${JSON.stringify(sourceUrl)})`);
            await nextFontFace.load();
            document.fonts.add(nextFontFace);
            previewLoadedFontMap.set(storedFont.customPath, nextFontFace);
          } catch (e) {
            console.warn('[DesktopLyricsPreview] Failed custom font load:', e);
          }
        }
      }

      previewViewport.style.fontFamily = targetFont;
      previewMain.style.fontFamily = targetFont;
      previewSub.style.fontFamily = targetFont;

      previewSub.style.display = showTranslation ? 'block' : 'none';

      if (wordByWord) {
        previewMain.innerHTML = `
          <span class="lyrics-word word-active">这</span>
          <span class="lyrics-word word-active">一</span>
          <span class="lyrics-word word-active">刻</span>
          <span style="margin:0 3px;"></span>
          <span class="lyrics-word word-singing" style="--char-fill:70%;background-image:linear-gradient(to right, var(--theme-accent, #00f2fe) 70%, var(--unfilled-color, rgba(255,255,255,0.45)) 70%);-webkit-background-clip:text;color:transparent;">画</span>
          <span class="lyrics-word" style="color:var(--unfilled-color, rgba(255,255,255,0.45));">面</span>
          <span class="lyrics-word" style="color:var(--unfilled-color, rgba(255,255,255,0.45));">定</span>
          <span class="lyrics-word" style="color:var(--unfilled-color, rgba(255,255,255,0.45));">格</span>
        `;
      } else {
        previewMain.textContent = '♪ 这一刻 画面定格在眼前 ♪';
      }
    };

    // 初始渲染一次桌面歌词预览效果
    setTimeout(() => {
      updateDesktopLyricsPreview();
    }, 50);

    const chooseCustomDesktopFont = async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{
            name: '字体文件',
            extensions: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
          }],
        });
        if (!selected) return false;

        const entry = await addUserFont(selected);
        localStorage.setItem('kimo-desktop-lyrics-font-mode', `user:${selected}`);
        localStorage.removeItem('kimo-desktop-lyrics-font-path');
        currentDesktopFontMode = `user:${selected}`;
        if (desktopLyricsFontSelect) desktopLyricsFontSelect.value = `user:${selected}`;
        if (customDesktopFontFile) {
          customDesktopFontFile.textContent = getFontFileName(selected);
          customDesktopFontFile.title = selected;
        }
        showToast(`已添加并应用桌面歌词字体「${entry.name}」`);
        renderUserFontList();
        refreshFontSelects();
        desktopLyrics?.updateStyle();
        updateDesktopLyricsPreview();
        return true;
      } catch (error) {
        console.error('[DesktopLyricsFont] Failed to apply custom desktop font:', error);
        showToast('字体文件无法加载，请尝试其他字体');
        return false;
      }
    };

    desktopLyricsFontSelect?.addEventListener('change', async (event) => {
      const nextMode = event.target.value;
      if (nextMode === 'custom') {
        const storedFont = getStoredDesktopLyricsFont();
        if (storedFont.customPath) {
          localStorage.setItem('kimo-desktop-lyrics-font-mode', 'custom');
          currentDesktopFontMode = 'custom';
          showToast('已切换至自定义桌面歌词字体');
          desktopLyrics?.updateStyle();
          updateDesktopLyricsPreview();
          return;
        }

        const applied = await chooseCustomDesktopFont();
        if (!applied) event.target.value = currentDesktopFontMode;
        return;
      }

      localStorage.setItem('kimo-desktop-lyrics-font-mode', nextMode);
      currentDesktopFontMode = nextMode;
      const preset = getFontOptions(true).find(item => item.value === nextMode);
      const userFont = nextMode.startsWith('user:') ? getUserFonts().find(f => f.path === nextMode.slice(5)) : null;
      showToast(`已切换桌面歌词字体为: ${userFont?.name || preset?.label || '默认字体'}`);
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    customDesktopFontBtn?.addEventListener('click', chooseCustomDesktopFont);

    // 绑定桌面歌词设置项与预览更新联动
    desktopLyricCard.querySelector('#settings-desktop-lyrics')?.addEventListener('change', (e) => {
      desktopLyrics?.setVisible(e.target.checked);
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-locked')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-locked', e.target.checked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    const dSizeSlider = desktopLyricCard.querySelector('#settings-desktop-lyrics-size');
    const dSizeVal = desktopLyricCard.querySelector('#desktop-lyrics-size-val');
    dSizeSlider?.addEventListener('input', (e) => {
      const size = e.target.value;
      if (dSizeVal) dSizeVal.textContent = `${size}px`;
      localStorage.setItem('kimo-desktop-lyrics-font-size', String(size));
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    const dOpSlider = desktopLyricCard.querySelector('#settings-desktop-lyrics-opacity');
    const dOpVal = desktopLyricCard.querySelector('#desktop-lyrics-opacity-val');
    dOpSlider?.addEventListener('input', (e) => {
      const opacity = e.target.value;
      if (dOpVal) dOpVal.textContent = `${Math.round(opacity * 100)}%`;
      localStorage.setItem('kimo-desktop-lyrics-opacity', String(opacity));
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-word-by-word')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-word-by-word', e.target.checked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-translation')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-show-translation', e.target.checked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-glow')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-glow', e.target.checked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-stroke')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-stroke', e.target.checked ? 'true' : 'false');
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    // 自定义歌词颜色（已播放 / 未播放）
    desktopLyricCard.querySelector('#settings-desktop-lyrics-custom-color')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-custom-color', e.target.checked ? 'true' : 'false');
      const colorRow = desktopLyricCard.querySelector('#settings-desktop-lyrics-color-row');
      if (colorRow) toggleSettingRow(colorRow, e.target.checked);
      const themeRow = desktopLyricCard.querySelector('#settings-desktop-lyrics-theme-row');
      if (themeRow) {
        toggleSettingRow(themeRow, !e.target.checked);
      }
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
      showToast(`自定义歌词颜色: ${e.target.checked ? '开启' : '关闭'}`);
    });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-color-active')?.addEventListener('input', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-color-active', e.target.value);
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });
    desktopLyricCard.querySelector('#settings-desktop-lyrics-color-inactive')?.addEventListener('input', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-color-inactive', e.target.value);
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-theme')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-theme', e.target.value);
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    desktopLyricCard.querySelector('#settings-desktop-lyrics-align')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-desktop-lyrics-align', e.target.value);
      desktopLyrics?.updateStyle();
      updateDesktopLyricsPreview();
    });

    const opInput = themeCard.querySelector('#settings-slider-opacity');
    const opDisplay = themeCard.querySelector('#settings-opacity-val');
    opInput.addEventListener('input', (e) => {
      const percentage = parseInt(e.target.value, 10);
      opDisplay.textContent = `${percentage}%`;
      const val = percentage / 100;
      localStorage.setItem('kimo-overlay-opacity-custom', 'true');
      applyTheme(getCurrentTheme(), val.toString());
    });
    opInput.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const nextVal = Math.max(0, Math.min(100, parseInt(opInput.value) + delta));
      opInput.value = nextVal;
      opDisplay.textContent = `${nextVal}%`;
      const val = nextVal / 100;
      localStorage.setItem('kimo-overlay-opacity-custom', 'true');
      applyTheme(getCurrentTheme(), val.toString());
    }, { passive: false });

    const zoomInput = themeCard.querySelector('#settings-slider-zoom');
    const zoomDisplay = themeCard.querySelector('#settings-zoom-val');
    zoomInput.addEventListener('input', (e) => {
      const percentage = parseInt(e.target.value, 10);
      zoomDisplay.textContent = `${percentage}%`;
      const val = percentage / 100;
      document.documentElement.style.setProperty('--ui-scale', val.toString());
      document.documentElement.style.zoom = val.toString();
      localStorage.setItem('kimo-ui-scale', val.toString());
    });
    zoomInput.addEventListener('change', (e) => {
      const percentage = parseInt(e.target.value, 10);
      const val = percentage / 100;
      localStorage.setItem('kimo-ui-scale', val.toString());
    });
    zoomInput.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const nextVal = Math.max(80, Math.min(120, parseInt(zoomInput.value) + delta));
      zoomInput.value = nextVal;
      zoomDisplay.textContent = `${nextVal}%`;
      const val = nextVal / 100;
      document.documentElement.style.setProperty('--ui-scale', val.toString());
      document.documentElement.style.zoom = val.toString();
      localStorage.setItem('kimo-ui-scale', val.toString());
    }, { passive: false });

    themeCard.querySelector('#settings-show-quality-badge')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-show-quality-badge', e.target.checked ? 'true' : 'false');
      showToast(e.target.checked ? '已开启音质标签展示 (SQ/Hi-Res/HQ)' : '已关闭音质标签展示');
      if (player && typeof player.updateUI === 'function' && player.playlist && player.playlist[player.currentIndex]) {
        player.updateUI(player.playlist[player.currentIndex]);
      }
    });

    themeCard.querySelector('#settings-show-bitrate-badge')?.addEventListener('change', (e) => {
      localStorage.setItem('kimo-show-bitrate-badge', e.target.checked ? 'true' : 'false');
      showToast(e.target.checked ? '已开启码率标签展示' : '已关闭码率标签展示');
      if (player && typeof player.updateUI === 'function' && player.playlist && player.playlist[player.currentIndex]) {
        player.updateUI(player.playlist[player.currentIndex]);
      }
    });

    // ══ 专辑封面取色设置 ══
    // 取色开关
    const colorToggle = themeCard.querySelector('#settings-color-extraction-toggle');
    colorToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('kimo-color-extraction', enabled ? 'on' : 'off');
      // 显示/隐藏取色模式行
      const modeRow = themeCard.querySelector('#settings-color-mode-row');
      if (modeRow) toggleSettingRow(modeRow, enabled);
      // 隐藏手动模式下的深浅滑块行
      const intensityRow = themeCard.querySelector('#settings-color-intensity-row');
      if (intensityRow) {
        if (!enabled) {
          toggleSettingRow(intensityRow, false);
        } else {
          // 恢复显示（取决于当前模式）
          const currentMode = localStorage.getItem('kimo-color-mode') || 'smart';
          toggleSettingRow(intensityRow, currentMode === 'manual');
        }
      }
      reapplyCurrentColor();
      showToast(enabled ? '已开启专辑封面取色' : '已关闭专辑封面取色，使用默认主题色');
    });

    // 取色模式分段按钮组
    themeCard.querySelectorAll('#settings-color-mode-group .setting-radio-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        themeCard.querySelectorAll('#settings-color-mode-group .setting-radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeCard.querySelector('#settings-color-mode-group').setAttribute('data-active-idx', idx.toString());
        const mode = btn.getAttribute('data-val');
        localStorage.setItem('kimo-color-mode', mode);
        // 显示/隐藏深浅滑块行
        const intensityRow = themeCard.querySelector('#settings-color-intensity-row');
        if (intensityRow) toggleSettingRow(intensityRow, mode === 'manual');
        reapplyCurrentColor();
        const modeNames = { smart: '智能取色', manual: '手动调节' };
        showToast(`取色模式已切换至: ${modeNames[mode] || mode}`);
      });
    });

    // 取色深浅滑块
    const colorIntensityInput = themeCard.querySelector('#settings-slider-color-intensity');
    const colorIntensityDisplay = themeCard.querySelector('#settings-color-intensity-val');
    if (colorIntensityInput) {
      // 拖动时实时更新显示和预览
      colorIntensityInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (colorIntensityDisplay) colorIntensityDisplay.textContent = val > 0 ? `+${val}` : `${val}`;
        localStorage.setItem('kimo-color-intensity', val);
        reapplyCurrentColor();
      });
      // 滚轮支持
      colorIntensityInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1 : -1;
        const nextVal = Math.max(-50, Math.min(50, parseInt(colorIntensityInput.value) + delta));
        colorIntensityInput.value = nextVal;
        if (colorIntensityDisplay) colorIntensityDisplay.textContent = nextVal > 0 ? `+${nextVal}` : `${nextVal}`;
        localStorage.setItem('kimo-color-intensity', nextVal);
        reapplyCurrentColor();
      }, { passive: false });
    }

    const fsInput = lyricCard.querySelector('#settings-slider-font-size');
    const fsDisplay = lyricCard.querySelector('#settings-font-size-val');
    fsInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      fsDisplay.innerText = `${val.toFixed(1)}px`;
      document.documentElement.style.setProperty('--lyrics-font-size', `${val}px`);
      if (player && player.lyrics) player.lyrics.resetAlignmentCache();
    });
    fsInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      localStorage.setItem('kimo-lyrics-font-size', val);
    });
    fsInput.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.5 : -0.5;
      const nextVal = Math.max(16, Math.min(48, parseFloat(fsInput.value) + delta));
      fsInput.value = nextVal;
      fsDisplay.innerText = `${nextVal.toFixed(1)}px`;
      document.documentElement.style.setProperty('--lyrics-font-size', `${nextVal}px`);
      if (player && player.lyrics) player.lyrics.resetAlignmentCache();
      localStorage.setItem('kimo-lyrics-font-size', nextVal);
    }, { passive: false });

    const liftInput = lyricCard.querySelector('#settings-slider-lift');
    const liftDisplay = lyricCard.querySelector('#settings-lift-val');
    liftInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      liftDisplay.innerText = `${val}px`;
    });
    liftInput.addEventListener('change', (e) => {
      const val = parseInt(e.target.value);
      updateLyricsPreference('liftAmplitude', val);
    });
    liftInput.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      const nextVal = Math.max(0, Math.min(5, parseInt(liftInput.value) + delta));
      liftInput.value = nextVal;
      liftDisplay.innerText = `${nextVal}px`;
      updateLyricsPreference('liftAmplitude', nextVal);
    }, { passive: false });

    const spacingInput = lyricCard.querySelector('#settings-slider-line-spacing');
    const spacingDisplay = lyricCard.querySelector('#settings-line-spacing-val');
    const applyLineSpacing = (val) => {
      spacingDisplay.innerText = `${parseFloat(val).toFixed(2)}`;
      document.documentElement.style.setProperty('--lyrics-line-spacing', val);
    };
    spacingInput.addEventListener('input', (e) => {
      applyLineSpacing(parseFloat(e.target.value));
    });
    spacingInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      localStorage.setItem('kimo-lyrics-line-spacing', val);
    });
    spacingInput.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const nextVal = Math.max(0, Math.min(2.0, parseFloat(spacingInput.value) + delta));
      spacingInput.value = nextVal;
      applyLineSpacing(nextVal);
      localStorage.setItem('kimo-lyrics-line-spacing', nextVal);
    }, { passive: false });

    const asrUrlInput = extCard.querySelector('#settings-asr-url');
    extCard.querySelector('#settings-save-asr-btn').addEventListener('click', () => {
      const url = asrUrlInput.value.trim();
      localStorage.setItem('kimo-ai-server-url', url);
      showToast('AI ASR 服务器地址保存成功');
    });

    // LunaBeat 事件处理
    const lunaUrlInput = extCard.querySelector('#settings-luna-url');
    const lunaPinInput = extCard.querySelector('#settings-luna-pin');
    const lunaEnabledInput = extCard.querySelector('#settings-luna-enabled');
    const lunaStatsInput = extCard.querySelector('#settings-luna-stats');
    const lunaStatus = extCard.querySelector('#settings-luna-status');
    const lunaSaveBtn = extCard.querySelector('#settings-luna-save-btn');

    lunaStatsInput?.addEventListener('change', () => {
      localStorage.setItem('kimo-luna-stats-enabled', String(lunaStatsInput.checked));
      showToast(lunaStatsInput.checked ? '局域网歌曲已计入月度统计' : '局域网歌曲不再计入月度统计');
    });

    const writeLunaConfig = () => {
      const cfg = {
        baseUrl: lunaUrlInput.value.trim(),
        pinCode: lunaPinInput.value.trim(),
        enabled: lunaEnabledInput.checked,
      };
      localStorage.setItem('kimo-lunabeat-config', JSON.stringify(cfg));
      return cfg;
    };

    lunaEnabledInput.addEventListener('change', () => {
      const cfg = writeLunaConfig();
      showToast(cfg.enabled ? '已开启 LunaBeat 局域网音源' : '已关闭 LunaBeat 局域网音源');
      // 重置适配器使新配置生效
      if (window.__lunaBeatAdapter) {
        window.__lunaBeatAdapter.dispose();
        window.__lunaBeatAdapter = null;
      }
    });

    lunaSaveBtn.addEventListener('click', async () => {
      const url = lunaUrlInput.value.trim();
      const pin = lunaPinInput.value.trim();
      if (!url) {
        if (lunaStatus) lunaStatus.textContent = '⚠️ 请先填写服务器地址';
        return;
      }
      if (!pin) {
        if (lunaStatus) lunaStatus.textContent = '⚠️ 请先填写配对码';
        return;
      }
      try {
        lunaSaveBtn.disabled = true;
        lunaSaveBtn.textContent = '连接中...';
        if (lunaStatus) lunaStatus.textContent = '正在连接...';
        // 临时实例测试
        const { LunaBeatAdapter } = await import('./luna-beat/luna-beat-adapter.js');
        const adapter = new LunaBeatAdapter(url);
        await adapter.authenticate(pin);
        if (adapter.authenticated) {
          // 同时写入配置
          writeLunaConfig();
          // 设为全局适配器
          if (window.__lunaBeatAdapter) window.__lunaBeatAdapter.dispose();
          window.__lunaBeatAdapter = adapter;
          if (lunaStatus) {
            lunaStatus.style.color = 'rgb(16,185,129)';
            lunaStatus.textContent = `✅ 连接成功！认证通过 (${url})`;
          }
          showToast('LunaBeat 连接成功');
        }
      } catch (e) {
        console.error('[LunaBeat] Connect failed:', e);
        if (lunaStatus) {
          lunaStatus.style.color = '#f87171';
          lunaStatus.textContent = `❌ 连接失败: ${e.message}`;
        }
        showToast('LunaBeat 连接失败');
      } finally {
        lunaSaveBtn.disabled = false;
        lunaSaveBtn.textContent = '保存&测试';
      }
    });

    // 如果有已保存的配置，显示状态
    if (savedLunaUrl && savedLunaPin) {
      if (lunaStatus) lunaStatus.textContent = `${savedLunaEnabled ? '🟢' : '⚪'} 已配置: ${savedLunaUrl}`;
    }

    scanCard.querySelectorAll('.scanned-path-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        scannedDirs.splice(idx, 1);
        localStorage.setItem('kimo-scanned-dirs', JSON.stringify(scannedDirs));
        showToast('已移出该扫描路径');
        renderSettingsTab();
      });
    });

    scanCard.querySelector('#settings-clear-dirs').addEventListener('click', async () => {
    if (await customConfirm('确定要清空所有本地音乐的缓存及扫描路径列表吗？此操作不可恢复。')) {
        localStorage.removeItem('kimo-scanned-dirs');
        localStorage.removeItem('kimo-scanned-dir');
        localStorage.removeItem('kimo-playlist-cache');
        localStorage.removeItem('kimo-music-library');
        player.playlist = [];
        setMusicLibrary([]);
        clearSearchCache();
        clearLyricsDB();
        showToast('歌曲缓存已清除');
        renderSettingsTab();
      }
    });

    scanCard.querySelector('#settings-add-dir-btn').addEventListener('click', async () => {
      try {
        const selected = await open({ directory: true, multiple: true });
        if (!selected) return;
        
        const newPaths = Array.isArray(selected) ? selected : [selected];
        newPaths.forEach(p => {
          if (!scannedDirs.includes(p)) {
            scannedDirs.push(p);
          }
        });

        localStorage.setItem('kimo-scanned-dirs', JSON.stringify(scannedDirs));
        showToast('成功添加扫描文件夹');
        renderSettingsTab();
      } catch (e) {
        console.error('Add directory error:', e);
        showToast('选择文件夹失败');
      }
    });

    scanCard.querySelector('#settings-scan-btn').addEventListener('click', async () => {
      if (scannedDirs.length === 0) {
        showToast('请先添加需要扫描的文件夹目标');
        return;
      }

      const scanBtn = scanCard.querySelector('#settings-scan-btn');
      scanBtn.disabled = true;
      scanBtn.innerText = '正在扫描目录...';

      let unlisten = null;
      try {
        // 1. 监听 Rust 侧流式进度事件
        unlisten = await listen('scan-progress', (event) => {
          const { current, total, title, skipped } = event.payload;
          scanBtn.innerText = skipped
            ? `正在建立索引(${current}/${total}) 跳过`
            : `正在建立索引(${current}/${total}) ${title || ''}`;
        });

        // 2. 一次性调用：Rust 侧完成 扫描 + 元数据解析 + 写入 SQLite
        const indexed = await invoke('scan_and_index_library', { dirs: scannedDirs });

        // 3. 从 SQLite 加载完整歌库
        const songs = await invoke('get_library_songs', { offset: 0, limit: 50000 });

        if (Array.isArray(songs) && songs.length > 0) {
          setMusicLibrary(songs);
          player.playlist = [...songs];
          resetDiscoverRecommendations();

          // 异步加载封面（不阻塞扫描完成提示）
          backgroundLoadCovers(player.playlist);

          // 清理歌库中已不存在的歌词缓存（不阻塞主流程）
          pruneLyricsCache(songs.map((s) => s.file_path));

          showToast(`扫描完成！共索引 ${indexed} 首新歌曲，歌库共 ${songs.length} 首`);
          try {
            switchTab('local');
          } catch (tabErr) {
            console.error('switchTab error after scan:', tabErr);
          }
        } else {
          showToast('扫描完成，未检索到有效的音频文件');
        }

        scanBtn.disabled = false;
        scanBtn.innerText = '立即重新扫描';
      } catch (err) {
        console.error('Global scan error:', err);
        showToast('扫描失败，请重试');
        scanBtn.disabled = false;
        scanBtn.innerText = '立即重新扫描';
      } finally {
        // 无论成功失败都释放事件监听，避免失败重扫时监听器累积泄漏
        if (unlisten) {
          try { unlisten(); } catch (e) {}
        }
      }
    });
  };

  return renderSettingsTab;
};
