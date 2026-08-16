import './styles.css';
import { renderAudioQualityBadgesHtml, renderArtistWithBadgesHtml } from './utils/audio-quality.js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { parseLRC, parseELRC, parseTTML, parseJSONLyrics, normalizeLyricsLines } from './lyrics.js';
import {
  getLyricLineText,
  synthesizePerCharWords,
} from './lyrics/animation-units.js';
import {
  applyDepthBlur,
  clearDepthBlur,
  markDepthBlurDirty,
} from './lyrics/depth-blur.js';
import {
  clampScrollTop,
  getAlignedScrollTop,
  getLyricsScrollAlign,
} from './lyrics/scroll-position.js';
import {
  buildLyricTimeIndex,
  calculateActiveLineState,
  calculateLinesToProcess,
  calculateViewActiveIndices,
} from './lyrics/sync-state.js';
import {
  calculateKaraokePlayheadState,
} from './lyrics/playhead.js';
import {
  renderClassicCharProgress,
} from './lyrics/progress-renderer.js';
import {
  collectLongGlowIndices,
  renderWordMotionEffects,
} from './lyrics/word-effects.js';
import {
  syncMiniBarSpans,
  updateMiniBarLyrics,
} from './lyrics/mini-bar.js';
import { updateLyricLineEndTimes } from './lyrics/line-timing.js';
import { getLyricsPreferences, updateLyricsPreference } from './lyrics/preferences.js';
import { filterLyricInformationLines } from './lyrics/info-filter.js';
import { renderTimedLyricWords } from './lyrics/line-renderer.js';
import { updateInactiveLineFixedState } from './lyrics/line-visual-state.js';
import {
  showFullLyricsModal,
  showLyricContextMenu,
} from './lyrics/lyrics-overlays.js';
import {
  smoothScrollToLine,
  staggeredScrollToLine,
} from './lyrics/scroll-animations.js';
import { updateLyricsVisualizer } from './lyrics/visualizer.js';
import {
  runSingleLineAlignment,
  saveLyricsCache as saveLyricsCacheForAudio,
  showCalibrationModal,
} from './lyrics/calibration.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { initializeWindowControls } from './core/window-controls.js';
import { MaterialEngine } from './engine/scheduler/material-engine.js';
import { MaterialLayer } from './engine/layer/material-layer.js';
import { MaterialRegistry } from './engine/material/material-registry.js';
import { MaterialThemeBridge } from './engine/bridge/material-theme-bridge.js';
import { FrostedGlassMaterial } from './engine/presets/frosted-glass.js';
import { GlassOverlayMaterial } from './engine/presets/glass-overlay.js';
import {
  getLikedPlaylist,
  isSongLiked,
  toggleLikedSong,
} from './features/playlist-service.js';
import { initializePlaylistPanel } from './features/playlist-panel.js';
import { toggleCommentsPanel, isCommentsPanelVisible, updateCommentsPanel } from './features/comments-panel.js';
import { createDiscoverPage } from './features/discover-page.js';
import { createLocalLibraryPage } from './features/local-library-page.js';
import { createLunaBeatPage } from './features/luna-beat/luna-beat-page.js';
import { initializeMetadataSavedSync } from './features/metadata-sync.js';
import { createPlaylistsPage } from './features/playlists-page.js';

import {
  parseEditableLyrics,
  serializeEditableLyrics,
} from './features/metadata-editor/lyrics-codec.js';
import { bindLyricsEditorControls } from './features/metadata-editor/lyrics-editor-controls.js';
import { renderLyricsTimeline as renderMetadataLyricsTimeline } from './features/metadata-editor/lyrics-timeline.js';
import {
  bindCoverControls,
  fillMetadataForm,
  getMetadataFormValues,
  setMetadataSaveBusy,
  toWriteMetadataPayload,
} from './features/metadata-editor/metadata-form.js';
import {
  addRecentPlay,
  createRecentPlaysRenderer,
  getRecentPlays,
} from './features/recent-plays.js';
import { cleanupOldStats } from './storage/play-stats.js';
import { createSettingsPage } from './features/settings-page.js';
import { PlaybackController } from './player/playback-controller.js';
import { createSearchController } from './search/search-controller.js';
import { SEARCH_WORKER_SOURCE } from './search/worker-source.js';
import { clearLyricsDB, loadAllLyricsFromDB, saveLyricsToDB } from './storage/lyrics-cache-db.js';
import { customConfirm, customPrompt } from './ui/dialogs.js';
import { initializeAlbumCoverMenu } from './ui/album-cover-menu.js';

import { initializeImmersiveMode } from './ui/immersive-mode.js';
import { initializeLyricsPreferencesControls } from './ui/lyrics-preferences-controls.js';
import { initializeCustomContextMenu } from './ui/context-menu.js';
import { initializePlayerControls } from './ui/player-controls.js';
import { initializeProgressScrubbing } from './ui/progress-scrubbing.js';
import { createDesktopLyricsController } from './ui/desktop-lyrics-controller.js';
import { showToast } from './ui/toast.js';
import { renderLoadingPlaceholder } from './ui/loading-state.js';
import { initializeVolumeControls } from './ui/volume-controls.js';
import { createKeyboardShortcutManager } from './ui/keyboard-shortcuts.js';
import { applyStoredInterfaceFont, applyStoredLyricsFont, ensureUserFonts, ensureBuiltinFonts, ensureDefaultFont } from './ui/interface-font.js';
import {
  applyMiniLyricsTranslationSetting,
  initializeLyricsSettingsToolbar,
} from './ui/lyrics-controls.js';
import { showStartupUpdateAnnouncement } from './ui/update-announcement.js';
import { startupUpdateCheck } from './ui/update-checker.js';
import { getCoverSrc, getSongCoverSrc } from './utils/cover.js';
import { extractDominantColor } from './utils/color.js';
import { transitionContent } from './ui/transitions.js';
import {
  applyDynamicColor,
  applyTheme,
  applyLyricsTheme,
  applyUiStyle,
  applyBackgroundStyle,
  applyWindowOpacity,
  applyWindowMaterial,
  applyAnimationSpeed,
  initLyricsTheme,
  configureThemePlayer,
  configureThemeDesktopLyrics,
  currentTheme,
  cycleTheme,
  getDefaultDynamicColor,
  getColorOptions,
  reapplyCurrentColor,
} from './ui/theme.js';

function clearLyricRowAnimationState(el) {
  if (el._scaleReleaseTimer) {
    clearTimeout(el._scaleReleaseTimer);
    el._scaleReleaseTimer = null;
  }
  el.style.transition = '';
  el.style.transitionDelay = '';
  el.style.transform = '';
  el.style.removeProperty('--lyric-motion-duration');
  el.style.removeProperty('--lyric-scale-duration');
  el.classList.remove('lyric-scale-leaving');

  const translationEl = el.querySelector('.lyrics-translation');
  if (translationEl) {
    translationEl.style.removeProperty('--translation-brighten-from-color');
    translationEl.style.removeProperty('--translation-brighten-from-opacity');
  }
}

function getAnimatedLyricRows(allLines, targetIndex, previousAnimatedRows = new Set()) {
  const animatedRows = [];
  const minIndex = Math.max(0, targetIndex - 14);
  const maxIndex = Math.min(allLines.length - 1, targetIndex + 18);

  allLines.forEach((el, index) => {
    if (index >= minIndex && index <= maxIndex) {
      animatedRows.push({ el, index });
    } else if (previousAnimatedRows.has(el) || el.style.transform || el.style.transition) {
      clearLyricRowAnimationState(el);
    }
  });

  return animatedRows;
}

function trackInterludeLayout(controller, duration = 760) {
  cancelAnimationFrame(controller._interludeLayoutTracker);
  const startedAt = performance.now();

  const keepAnchorStable = (now) => {
    if (!controller.isUserScrolling) {
      const container = document.getElementById('lyrics-scroll');
      const lineEl = controller._cachedAllLines?.[controller.currentScrollIndex];
      if (container && lineEl) {
        container.scrollTop = clampScrollTop(
          container,
          getAlignedScrollTop(container, lineEl),
        );
      }
    }

    if (now - startedAt < duration) {
      controller._interludeLayoutTracker = requestAnimationFrame(keepAnchorStable);
    } else {
      controller._interludeLayoutTracker = null;
    }
  };

  controller._interludeLayoutTracker = requestAnimationFrame(keepAnchorStable);
}

// ══ Early Shell Window Controls (Rust-Command Driven) ══
initializeWindowControls();

// Shared in-memory state for the structured lyrics editor.
let currentEditableLyrics = [];
let currentLyricsType = 'lrc'; // 'json', 'word-lrc', 'ttml' 或者 'lrc'
let currentLyricsEditorMode = 'timeline'; // 'timeline' 或者是 'raw'

// ══ Lyrics Controller ══
class LyricsController {
  constructor(player) {
    this.player = player;
    this.lines = [];
    this.activeIndex = -1;
    this.miniBarIndex = -1;
    this.desktopLyricsController = null;
    this.isVisible = false;
    this.animFrameId = null;
    this.isUserScrolling = false;
    this.isAutoScrolling = false;
    this.currentScrollIndex = -1;
    this._lastViewActiveKey = '';
    this._lastInterludeVisualKey = '';
    this._scrollTimeout = null;
    this._loadGeneration = 0;
    this._timeIndex = null;
    this._lastAnimatedScrollRows = new Set();
    this._concurrentScrollGroup = null;
    this._concurrentScrollAnchor = -1;
    this._manualSeekScrollIndex = -1;
    this._hasPositionedCurrentLyrics = false;
    // Cache lyric row nodes to avoid repeated DOM tree scans.
    this._cachedAllLines = null;
    const compatibilityMode = localStorage.getItem('kimo-lyrics-compatibility-mode');
    this.lyricsCompatibilityMode = ['auto', 'char', 'line'].includes(compatibilityMode)
      ? compatibilityMode
      : 'auto';

    // Detect manual scroll: clear blur so user can read
    const scrollEl = document.getElementById('lyrics-scroll');
    if (scrollEl) {
      scrollEl.addEventListener('wheel', () => this.onUserScroll(), { passive: true });
      scrollEl.addEventListener('touchmove', () => this.onUserScroll(), { passive: true });
      scrollEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const oldMenu = document.getElementById('kimo-lyrics-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'kimo-lyrics-context-menu';
        menu.className = 'kimo-context-menu';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const menuItemFull = document.createElement('div');
        menuItemFull.className = 'kimo-context-menu-item';
        menuItemFull.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; color:var(--text-secondary);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <span>查看完整歌词文本</span>
        `;
        menuItemFull.addEventListener('click', () => {
          menu.remove();
          this.viewFullLyrics();
        });
        menu.appendChild(menuItemFull);
        document.body.appendChild(menu);

        const clickOut = () => {
          menu.remove();
          document.removeEventListener('click', clickOut);
        };
        setTimeout(() => {
          document.addEventListener('click', clickOut);
        }, 50);
      });
    }

    this.lyricsStaggerMode = localStorage.getItem('kimo-lyrics-stagger-mode') || 'word';
    this.updateStaggerUI();
  }

  updateStaggerUI() {
    const btn = document.getElementById('btn-stagger-toggle');
    const label = document.getElementById('lyric-stagger-value');
    if (btn) {
      if (this.lyricsStaggerMode === 'stagger') {
        btn.classList.add('stagger-active');
        btn.title = '当前模式: 字母依次上移 (点击切换为单词整体)';
      } else {
        btn.classList.remove('stagger-active');
        btn.title = '当前模式: 单词整体上移 (点击切换为字母依次)';
      }
    }
    if (label) {
      label.textContent = this.lyricsStaggerMode === 'stagger' ? '字母依次上移' : '单词整体上移';
    }
  }

  toggleStaggerMode() {
    this.lyricsStaggerMode = this.lyricsStaggerMode === 'stagger' ? 'word' : 'stagger';
    localStorage.setItem('kimo-lyrics-stagger-mode', this.lyricsStaggerMode);
    this.updateStaggerUI();
    this.render();
    if (this.isVisible) {
      this.realign();
      if (this.player?.audio) this.syncToTime(this.player.audio.currentTime);
    }
  }

  onUserScroll() {
    this.isUserScrolling = true;
    this.clearBlur();
    // Restore blur after 3s of no manual scrolling
    clearTimeout(this._scrollTimeout);
    this._scrollTimeout = setTimeout(() => {
      this.isUserScrolling = false;
      const allLines = document.querySelectorAll('#lyrics-lines .lyrics-line');
      if (this.activeIndex >= 0) {
        this.applyBlur(this.activeIndex, this.currentScrollIndex, allLines);
      }
    }, 3000);
  }

  applyBlur(activeIndices, scrollIdx, allLines) {
    applyDepthBlur({
      activeIndices,
      scrollIdx,
      activeIndex: this.activeIndex,
      allLines,
      isAutoScrolling: this.isAutoScrolling,
    });
  }

  clearBlur() {
    const lines = this._cachedAllLines || Array.from(document.querySelectorAll('#lyrics-lines .lyrics-line'));
    clearDepthBlur(lines);
  }

  setBlurEnabled(enabled) {
    updateLyricsPreference('blurEnabled', enabled);
    const lines = this._cachedAllLines || Array.from(document.querySelectorAll('#lyrics-lines .lyrics-line'));
    markDepthBlurDirty(lines);
    this.applyBlur(this.activeIndices || [], this.currentScrollIndex || 0, lines);
  }

  updateSpacerHeights() {
    const container = document.getElementById('lyrics-scroll');
    if (!container) return;
    const spacers = container.querySelectorAll('.lyrics-spacer');
    if (spacers.length >= 2) {
      const containerHeight = container.clientHeight || container.getBoundingClientRect().height || 500;
      const alignOffset = getLyricsScrollAlign();
      
      const topSpacerHeight = containerHeight * alignOffset;
      const bottomSpacerHeight = containerHeight * (1 - alignOffset);
      
      spacers[0].style.height = `${topSpacerHeight}px`;
      spacers[1].style.height = `${bottomSpacerHeight}px`;
    }
  }

  realign() {
    this.updateSpacerHeights();
    const container = document.getElementById('lyrics-scroll');
    const allLines = document.querySelectorAll('#lyrics-lines .lyrics-line');
    // 鑻ユ湭寮€濮嬫挱鏀撅紝榛樿浠ョ涓€琛?0) 杩涜鐗╃悊瀵归綈璁＄畻
    const scrollIndex = this.currentScrollIndex >= 0 ? this.currentScrollIndex : 0;
    if (container && allLines && allLines[scrollIndex]) {
      const lineEl = allLines[scrollIndex];
      container.scrollTop = getAlignedScrollTop(container, lineEl);
    }
  }

  resetAlignmentCache() {
    const allLines = document.querySelectorAll('#lyrics-lines .lyrics-line');
    allLines.forEach(el => {
      el.removeAttribute('data-bg-aligned');
      el.dataset.bgAligned = 'false';
      delete el.rowsData;
      delete el._wordSpans;
      delete el._wordsList;
      delete el._prevFirstRelativeTop;
      delete el._prevLastRelativeTop;
      delete el.dataset.fixedState;
      delete el._lastFilter;
      delete el._lastOpacity;
      
      el.style.removeProperty('--line-width');
      el.querySelectorAll('.lyrics-word').forEach(w => {
        w.style.removeProperty('--line-width');
        w.style.removeProperty('--char-offset');
        w.style.removeProperty('--glow-left-pct');
        w.style.removeProperty('--glow-right-pct');
        w.style.removeProperty('--glow-mid-pct');
        w.style.removeProperty('--char-fill');
        w.removeAttribute('data-row-index');
        delete w.dataset.rowIndex;
        delete w.dataset.fillVal;
        delete w.dataset.liftVal;
        delete w._lastFill;
        delete w._lastPercent;
      });
      el.querySelectorAll('.lyrics-ruby-suffix').forEach(s => {
        s.style.removeProperty('--char-offset');
      });
    });
  }

  _getLineText(line) {
    return getLyricLineText(line);
  }

  _synthesizePerCharWords(line, idx) {
    return synthesizePerCharWords(line, this.lines[idx + 1]);
  }

  syncBarSpans(wordSpans, charWords, currentTime) {
    this._barWordSpans = syncMiniBarSpans({
      cachedSpans: this._barWordSpans,
      charWords,
      currentTime,
    });
  }

  updateBarLyrics(activeIdx) {
    this._barWordSpans = updateMiniBarLyrics({
      lines: this.lines,
      activeIndex: activeIdx,
      getLineText: line => this._getLineText(line),
    });
  }

  setDesktopLyricsController(controller) {
    this.desktopLyricsController = controller;
  }

  // 切歌到无歌词音乐时清空桌面歌词，避免残留上一曲内容
  _clearDesktopLyrics() {
    this.desktopLyricsController?.sync({
      text: '',
      translation: '',
      nextText: '',
      nextTranslation: '',
      words: null,
      currentTime: 0,
      lineStart: 0,
      lineEnd: 0,
    });
  }

  async load(audioPath) {
    const loadGeneration = ++this._loadGeneration;
    this.audioPath = audioPath;
    this.lines = [];
    this._timeIndex = null;
    this._lastAnimatedScrollRows.clear();
    this._concurrentScrollGroup = null;
    this._concurrentScrollAnchor = -1;
    this._manualSeekScrollIndex = -1;
    this._hasPositionedCurrentLyrics = false;
    this.currentScrollIndex = -1;
    this._lastActiveIndicesKey = '';
    this._lastVisualScrollIndex = -1;
    this._lastViewActiveKey = '';
    clearTimeout(this._scrollCleanup);
    this.isAutoScrolling = false;
    this.activeIndex = -1;
    this.miniBarIndex = -1;
    this._barWordSpans = null; // 清空迷你歌词缓存，避免引用已失效的DOM
    const linesEl = document.getElementById('lyrics-lines');
    // 独立元数据编辑窗口不包含主歌词容器，不应执行播放器歌词渲染。
    if (!linesEl) {
      return;
    }
    linesEl.innerHTML = '';
    
    const barLyric1 = document.getElementById('bar-lyric-text-1');
    const barLyric2 = document.getElementById('bar-lyric-text-2');
    if (barLyric1) barLyric1.textContent = '';
    if (barLyric2) barLyric2.textContent = '';

    try {
      const result = await invoke('get_lyrics', { audioPath });
      // A slower request for the previous track must never replace the lyrics
      // of a track selected while it was still loading.
      if (loadGeneration !== this._loadGeneration || audioPath !== this.audioPath) {
        return;
      }
      console.log('[Lyrics] type:', result.lyrics_type, 'content length:', result.content.length);

      if (result.lyrics_type === 'none') {
        linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
        if (barLyric1) barLyric1.textContent = '暂无歌词';
        if (barLyric2) barLyric2.textContent = '';
        this._clearDesktopLyrics();
        return;
      }

      if (result.lyrics_type === 'lrc') {
        this.lines = parseLRC(result.content);
      } else if (result.lyrics_type === 'elrc' || result.lyrics_type === 'enhanced-lrc') {
        this.lines = parseELRC(result.content);
      } else if (result.lyrics_type === 'ttml') {
        this.lines = parseTTML(result.content);
      } else if (result.lyrics_type === 'json') {
        this.lines = parseJSONLyrics(result.content);
      }
      this.lines = normalizeLyricsLines(this.lines, {
        inferTiming: result.lyrics_type === 'ttml',
      });

      this.lines = filterLyricInformationLines(this.lines, {
        enabled: getLyricsPreferences().filterInfoEnabled,
        song: this.player.playlist?.[this.player.currentIndex] || null,
      });

      if (this.lines.length === 0) {
        linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
        if (barLyric1) barLyric1.textContent = '暂无歌词';
        if (barLyric2) barLyric2.textContent = '';
        this._clearDesktopLyrics();
        return;
      }

      // --- Insert Interlude Lines for long gaps ---
      if (this.lines.length > 0) {
        const newLines = [];
        for (let i = 0; i < this.lines.length; i++) {
           const line = this.lines[i];
           if (i === 0) {
               if (line.time > 8.0) {
                   newLines.push({
                       time: 0,
                       end: line.time - 0.3,
                       endTime: line.time - 0.3,
                       role: line.role,
                       isInterlude: true,
                       text: '...'
                   });
               }
           } else {
               const prevLine = this.lines[i-1];
               const prevEnd = prevLine.end || (prevLine.words && prevLine.words.length > 0 ? prevLine.words[prevLine.words.length - 1].time + 1.0 : prevLine.time + 2.0);
               if (line.time - prevEnd > 8.0) {
                   let layoutSource = line;
                   for (let sourceIndex = i; sourceIndex < this.lines.length; sourceIndex += 1) {
                       if (!this.lines[sourceIndex].isBackground) {
                           layoutSource = this.lines[sourceIndex];
                           break;
                       }
                   }
                   newLines.push({
                       time: prevEnd + 1.0,
                       end: line.time - 0.3,
                       endTime: line.time - 0.3,
                       role: layoutSource.role,
                       isInterlude: true,
                       text: '...'
                   });
               }
           }
           newLines.push(line);
        }
        this.lines = newLines;
      }

      // console.log('[Lyrics] parsed lines:', this.lines.length);
      // this.lines.forEach((l, i) => console.log(`  [${i}] "${l.text}" | trans: "${l.translation || '-'}" | words: ${l.words ? l.words.length : 0} | interlude: ${!!l.isInterlude}`));

      this.render();
      // 切歌过渡：新歌词整列上移进入动画（渲染完成后触发，无清空时序风险）
      linesEl.classList.remove('lyrics-track-enter');
      void linesEl.offsetWidth;
      linesEl.classList.add('lyrics-track-enter');
      clearTimeout(this._trackEnterTimer);
      this._trackEnterTimer = setTimeout(() => {
        linesEl.classList.remove('lyrics-track-enter');
      }, 380);
      // Force update of player bar lyrics immediately after loading completes,
      // ensuring the cloned nodes/spans are rendered instantly instead of falling back.
      const currentActive = this.activeIndex >= 0 ? this.activeIndex : 0;
      this.updateBarLyrics(currentActive);
      this.startSync();
    } catch (e) {
      if (loadGeneration !== this._loadGeneration || audioPath !== this.audioPath) {
        return;
      }
      console.error('Lyrics load error:', e);
      linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
      if (barLyric1) barLyric1.textContent = '暂无歌词';
      if (barLyric2) barLyric2.textContent = '';
      this._clearDesktopLyrics();
    }
  }

  /** 加载 LunaBeat 在线歌词 */
  async loadLunaBeat(song) {
    const loadGeneration = ++this._loadGeneration;
    this.audioPath = `luna://${song._lunaId}`;
    this.lines = [];
    this._timeIndex = null;
    this._lastAnimatedScrollRows.clear();
    this._concurrentScrollGroup = null;
    this._concurrentScrollAnchor = -1;
    this._manualSeekScrollIndex = -1;
    this._hasPositionedCurrentLyrics = false;
    this.currentScrollIndex = -1;
    this._lastActiveIndicesKey = '';
    this._lastVisualScrollIndex = -1;
    this._lastViewActiveKey = '';
    clearTimeout(this._scrollCleanup);
    this.isAutoScrolling = false;
    this.activeIndex = -1;
    this.miniBarIndex = -1;
    this._barWordSpans = null;
    const linesEl = document.getElementById('lyrics-lines');
    if (!linesEl) return;
    linesEl.innerHTML = '';
    const barLyric1 = document.getElementById('bar-lyric-text-1');
    const barLyric2 = document.getElementById('bar-lyric-text-2');
    if (barLyric1) barLyric1.textContent = '';
    if (barLyric2) barLyric2.textContent = '';

    try {
      const { loadLunaBeatLyrics } = await import('./features/luna-beat/luna-beat-adapter-utils.js');
      const lunaLines = await loadLunaBeatLyrics(song);

      if (loadGeneration !== this._loadGeneration || this.audioPath !== `luna://${song._lunaId}`) return;
      if (!lunaLines || lunaLines.length === 0) {
        linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
        if (barLyric1) barLyric1.textContent = '暂无歌词';
        if (barLyric2) barLyric2.textContent = '';
        this._clearDesktopLyrics();
        return;
      }

      // LAN lyrics arrive through the LunaBeat JSON adapter, but use the
      // same canonical shape and precise-overlap duet inference as local TTML.
      this.lines = normalizeLyricsLines(lunaLines, { inferTiming: true });
      this.lines = filterLyricInformationLines(this.lines, {
        enabled: getLyricsPreferences().filterInfoEnabled,
        song: this.player.playlist?.[this.player.currentIndex] || null,
      });

      // 插入间奏行
      if (this.lines.length > 0) {
        const newLines = [];
        for (let i = 0; i < this.lines.length; i++) {
          const line = this.lines[i];
          if (i === 0) {
            if (line.time > 8.0) {
              newLines.push({ time: 0, end: line.time - 0.3, endTime: line.time - 0.3, isInterlude: true, text: '...' });
            }
          } else {
            const prevLine = this.lines[i - 1];
            const prevEnd = prevLine.end || (prevLine.words && prevLine.words.length > 0 ? prevLine.words[prevLine.words.length - 1].time + 1.0 : prevLine.time + 2.0);
            if (line.time - prevEnd > 8.0) {
              newLines.push({ time: prevEnd + 1.0, end: line.time - 0.3, endTime: line.time - 0.3, isInterlude: true, text: '...' });
            }
          }
          newLines.push(line);
        }
        this.lines = newLines;
      }

      if (this.lines.length === 0) {
        linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
        this._clearDesktopLyrics();
        return;
      }

      this.render();
      // 切歌过渡：与本地歌词一致，新歌词整列上移进入动画
      linesEl.classList.remove('lyrics-track-enter');
      void linesEl.offsetWidth;
      linesEl.classList.add('lyrics-track-enter');
      clearTimeout(this._trackEnterTimer);
      this._trackEnterTimer = setTimeout(() => {
        linesEl.classList.remove('lyrics-track-enter');
      }, 380);
      const currentActive = this.activeIndex >= 0 ? this.activeIndex : 0;
      this.updateBarLyrics(currentActive);
      this.startSync();
    } catch (e) {
      if (loadGeneration !== this._loadGeneration || this.audioPath !== `luna://${song._lunaId}`) return;
      console.error('[LunaBeat] Lyrics load error:', e);
      linesEl.innerHTML = '<div class="lyrics-line" style="text-align:center; color:var(--text-secondary);">暂无歌词</div>';
      if (barLyric1) barLyric1.textContent = '暂无歌词';
      if (barLyric2) barLyric2.textContent = '';
      this._clearDesktopLyrics();
    }
  }

  render() {
    const container = document.getElementById('lyrics-lines');
    container.innerHTML = '';
    // Clear layout caches before rendering and rebuild them afterward.
    this._cachedAllLines = null;
    this._lastInterludeVisualKey = '';
    
    // Remove global interlude overlay if it exists
    const oldGlobal = document.getElementById('global-interlude');
    if (oldGlobal) oldGlobal.remove();

    this.lines.forEach((line, idx) => {
      const div = document.createElement('div');
      div.className = 'lyrics-line';
      div.dataset.index = idx;
      
      // 猸?瀵瑰敱瑙掕壊涓庤儗鏅瓕璇嶆牱寮忔敞鍏モ瓙
      if (line.isBackground) {
        div.classList.add('is-background-line');
      }
      if (Number.isInteger(line.duetLane)) {
        div.classList.add('duet-line', `duet-lane-${Math.max(0, Math.min(1, line.duetLane))}`);
      }
      if (line.role) {
        const cleanRole = line.role.trim().toLowerCase().replace(/\s+/g, '-');
        const roleOne = /(?:^|-)(?:l1|v1|voice1|vocal1|singer1|lead1)(?:-|$)/.test(cleanRole);
        const roleTwo = /(?:^|-)(?:l2|v2|voice2|vocal2|singer2|lead2)(?:-|$)/.test(cleanRole);
        div.classList.add(`role-${cleanRole}`);
        if (roleOne) div.classList.add('role-l1');
        if (roleTwo) div.classList.add('role-l2');
        if (cleanRole.includes('both') || cleanRole.includes('v3') || (roleOne && roleTwo)) {
          div.classList.add('role-both');
        }
      }
      
      if (line.isInterlude) {
        div.classList.add('is-interlude-line');
      }

      // Main text (with word spans if available)
      const mainDiv = document.createElement('div');

      if (line.isInterlude) {
        mainDiv.className = 'lyrics-interlude';
        for(let j=0; j<3; j++) {
            const dot = document.createElement('span');
            dot.className = 'interlude-dot';
            mainDiv.appendChild(dot);
        }
      } else {
        mainDiv.className = 'lyrics-main';
        const nextLine = this.lines[idx + 1];
        let renderLine = line;

        // Compatibility mode can deliberately collapse a provider's detailed
        // timing to one line unit, or force character timing for line-only
        // lyrics. Keep this render-only so the parsed source data is intact.
        if (this.lyricsCompatibilityMode === 'line') {
          const lineEnd = Number.isFinite(line.end) && line.end > line.time
            ? line.end
            : (nextLine && nextLine.time > line.time ? nextLine.time : line.time + 3);
          renderLine = {
            ...line,
            words: [{
              time: line.time,
              end: lineEnd,
              duration: lineEnd - line.time,
              text: line.text || '',
            }],
          };
        }

        // Per-character karaoke fallback: synthesize per-char timing from line-level timestamps
        if (this.lyricsCompatibilityMode !== 'line' && (!line.words || line.words.length === 0)) {
          line.words = this._synthesizePerCharWords(line, idx);
        }
        if (renderLine.words && renderLine.words.length >= 1) {
          line.charWords = renderTimedLyricWords({
            mainDiv,
            line: renderLine,
            nextLine,
            staggerMode: this.lyricsStaggerMode,
            compatibilityMode: this.lyricsCompatibilityMode,
          });
        } else {
          mainDiv.textContent = line.text;
        }
      }
      div.appendChild(mainDiv);

      // Translation line
      if (line.translation) {
        const transDiv = document.createElement('div');
        transDiv.className = 'lyrics-translation';
        transDiv.textContent = line.translation;
        div.appendChild(transDiv);
        div.classList.add('has-translation');
      }

      // ⭐ Roman / Furigana 整行注音（和 translation 同款独立行，但放在「正文 mainDiv 的上方」，
      //    与 LunaBeat / Apple Music 整行 romanLyric 显示一致，颜色透明度对齐逐字 ruby 的 .lyrics-rt-text）
      if (line.romanLyric) {
        const romanDiv = document.createElement('div');
        romanDiv.className = 'lyrics-roman-lyric';
        romanDiv.textContent = line.romanLyric;
        // 放在 translation 之前，mainDiv 之后（这样 DOM 顺序是：main → roman? → translation?）
        // CSS 里会让 lyrics-roman-lyric 显示在 main 上方，就像逐字注音那样。
        div.insertBefore(romanDiv, div.querySelector('.lyrics-translation') || div.lastChild.nextSibling || null);
        div.classList.add('has-roman-lyric');
      }

      div.addEventListener('click', () => {
        this.seekToLine(line, idx);
      });
      
      // Bind the context-menu shortcut for single-line AI calibration.
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showCalibrationContextMenu(idx, e.clientX, e.clientY);
      });
      
      container.appendChild(div);
    });

    // All character-word nodes are ready after rendering completes.
    // Recalculate accurate line end times after all word nodes are rendered.
    updateLyricLineEndTimes(this.lines);
    this._timeIndex = buildLyricTimeIndex(this.lines);
    this.updateSpacerHeights();
  }

  showCalibrationContextMenu(idx, clientX, clientY) {
    showLyricContextMenu({
      line: this.lines[idx],
      lineIndex: idx,
      clientX,
      clientY,
      onCalibrate: lineIndex => this.startSingleLineCalibration(lineIndex),
      onSeek: line => this.seekToLine(line, idx),
      onViewFullLyrics: () => this.viewFullLyrics(),
    });
  }

  seekToLine(line, targetIndex = this.lines.indexOf(line)) {
    if (!line || !Number.isFinite(line.time)) return;

    // syncToTime() applies the configured lyric offset when rendering. Seek
    // to its inverse so the requested lyric starts visually at the same
    // instant instead of leaving the previous row fully highlighted.
    const { timeOffset } = getLyricsPreferences();
    const duration = Number.isFinite(this.player.audio.duration)
      ? this.player.audio.duration
      : Infinity;
    const audioTime = Math.max(0, Math.min(duration, line.time - timeOffset));

    this.player.audio.currentTime = audioTime;

    // Drop overlap/physics state from the old playback position and render
    // the requested time immediately. Restarting the clock also prevents one
    // stale extrapolated frame from repainting the previous line.
    this._previousLyricTime = undefined;
    this._prevPhysicsNow = performance.now();
    this._concurrentScrollGroup = null;
    this._concurrentScrollAnchor = -1;
    this._manualSeekScrollIndex = Math.max(0, targetIndex);
    this.syncToTime(audioTime, this._prevPhysicsNow);
    this.startSync();
  }

  viewFullLyrics() {
    showFullLyricsModal({
      lines: this.lines,
      onToast: message => this.showToast(message),
    });
  }

  async startSingleLineCalibration(idx) {
    const line = this.lines[idx];
    if (!line || !this.audioPath) return;
    this.showCalibrationModal(line, idx);
  }

  showCalibrationModal(line, idx) {
    showCalibrationModal({
      line,
      lineIndex: idx,
      onRun: (targetLine, lineIndex, modal) => this.runSingleLineAlignment(targetLine, lineIndex, modal),
    });
  }

  async runSingleLineAlignment(line, idx, modalEl) {
    await runSingleLineAlignment({
      line,
      lineIndex: idx,
      modal: modalEl,
      lines: this.lines,
      audioPath: this.audioPath,
      invoke: window.__TAURI__.core.invoke,
      onApply: (aiSyllables, modal) => {
        if (aiSyllables.length > 0) {
          line.time = aiSyllables[0].time;
        }
        line.words = aiSyllables;
        line.isWordTimed = true;

        this.render();
        this.saveLyricsCache();

        modal.remove();
        this.showToast('AI ???????????');
      },
    });
  }

  saveLyricsCache() {
    saveLyricsCacheForAudio({
      audioPath: this.audioPath,
      lines: this.lines,
      invoke: window.__TAURI__.core.invoke,
    });
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'kimo-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  updateVisualizer() {
    const state = updateLyricsVisualizer({
      player: this.player,
      audioContext: this.audioContext,
      audioSource: this.audioSource,
      analyser: this.analyser,
      dataArray: this.dataArray,
      visualizerHeights: this.visualizerHeights,
    });

    this.audioContext = state.audioContext;
    this.audioSource = state.audioSource;
    this.analyser = state.analyser;
    this.dataArray = state.dataArray;
    this.visualizerHeights = state.visualizerHeights;
  }

  startSync() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    
    let extrapolatedTime = this.player.audio.currentTime;
    let lastSysTime = performance.now();
    let lastAudioTime = extrapolatedTime;
    let lastPresentedTime = extrapolatedTime;
    let lastVisTime = 0;

    const tick = (now) => {
      // Pause the animation loop while the page is hidden.
      if (document.hidden) {
        this.animFrameId = requestAnimationFrame(tick);
        return;
      }

      const audioTime = this.player.audio.currentTime;
      const isPaused = this.player.audio.paused;
      const dt = (now - lastSysTime) / 1000;
      lastSysTime = now;
      const jumpedBackward = audioTime < lastAudioTime - 0.25;

      if (!isPaused && !this.player.audio.seeking && !jumpedBackward) {
        // Move time forward smoothly
        extrapolatedTime += dt * (this.player.audio.playbackRate || 1);

        // When the browser's audio time updates, gently correct our extrapolated time
        if (audioTime !== lastAudioTime) {
          const diff = audioTime - extrapolatedTime;
          if (diff > 0.15) {
            extrapolatedTime = audioTime;
          } else {
            // Negative drift is corrected gradually and clamped below so a
            // coarse audio clock update can never rewind the karaoke fill.
            extrapolatedTime += diff * 0.18;
          }
          lastAudioTime = audioTime;
        }

        extrapolatedTime = Math.max(lastPresentedTime, extrapolatedTime);
      } else {
        extrapolatedTime = audioTime;
        lastAudioTime = audioTime;
      }

      lastPresentedTime = extrapolatedTime;

      this.syncToTime(extrapolatedTime, now);
      
      // Throttle spectrum DOM updates to roughly 30 FPS.
      if (this.isVisible && !isPaused) {
        if (now - lastVisTime >= 30) {
          this.updateVisualizer();
          lastVisTime = now;
        }
      }

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  stopSync() {
    if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = null; }
  }

  syncToTime(rawCurrentTime, frameNow = performance.now()) {
    if (!this.lines.length) return;
    
    const preferences = getLyricsPreferences();
    const timeOffset = preferences.timeOffset;
    const currentTime = rawCurrentTime + timeOffset;

    this._prevPhysicsNow = frameNow;

    // Seeking changes lyric time discontinuously; animation physics should not
    // interpret that jump as motion elapsed between two adjacent frames.
    if (this._previousLyricTime !== undefined && Math.abs(currentTime - this._previousLyricTime) > 0.5) {
      this._prevPhysicsNow = frameNow;
      this._concurrentScrollGroup = null;
      this._concurrentScrollAnchor = -1;
    }
    this._previousLyricTime = currentTime;

    // Keep time-state calculation independent from DOM rendering.
    const lineState = calculateActiveLineState(this.lines, currentTime, this._timeIndex);
    const { activeIndices, activeIndex } = lineState;
    let { scrollIndex } = lineState;

    // Treat foreground rows as concurrent only while their real timestamp
    // ranges are simultaneously active. A row may overlap both its previous
    // and next neighbours, so membership must be allowed to advance.
    const foregroundActiveIndices = activeIndices.filter(index => (
      !this.lines[index].isBackground && !this.lines[index].isInterlude
    ));
    const hasActiveInterlude = activeIndices.some(index => this.lines[index].isInterlude);
    if (this._concurrentScrollGroup && hasActiveInterlude) {
      this._concurrentScrollGroup = null;
      this._concurrentScrollAnchor = -1;
    }
    if (this._concurrentScrollGroup) {
      const anchorStillActive = foregroundActiveIndices.includes(this._concurrentScrollAnchor);
      if (!anchorStillActive) {
        this._concurrentScrollGroup = null;
        this._concurrentScrollAnchor = -1;
      }
    }
    if (!this._concurrentScrollGroup && foregroundActiveIndices.length > 1) {
      this._concurrentScrollGroup = new Set(foregroundActiveIndices);
      this._concurrentScrollAnchor = foregroundActiveIndices.includes(this.currentScrollIndex)
        ? this.currentScrollIndex
        : activeIndex;
    }
    if (this._concurrentScrollGroup
      && foregroundActiveIndices.includes(this._concurrentScrollAnchor)) {
      scrollIndex = this._concurrentScrollAnchor;
    }

    // A clicked lyric is an explicit positioning request. During its phrase,
    // keep that row on the playback line even if a preceding phrase still
    // overlaps in time and would normally remain the duet scroll anchor.
    if (this._manualSeekScrollIndex >= 0) {
      const manualIndex = this._manualSeekScrollIndex;
      const manualLine = this.lines[manualIndex];
      let nextScrollTime = Infinity;

      for (let nextIndex = manualIndex + 1; nextIndex < this.lines.length; nextIndex += 1) {
        const nextLine = this.lines[nextIndex];
        if (
          !nextLine.isBackground
          && nextLine.time > manualLine.time + 0.01
        ) {
          // Interludes are real scroll destinations too. Releasing only at
          // the next sung phrase would pin a completed clicked row throughout
          // the entire instrumental gap.
          nextScrollTime = nextLine.time;
          break;
        }
      }

      if (
        manualLine
        && currentTime >= manualLine.time - 0.1
        && currentTime < nextScrollTime
      ) {
        scrollIndex = manualIndex;
      } else {
        this._manualSeekScrollIndex = -1;
      }
    }

    // Mini lyrics should follow the newest line that has actually started.
    // Unlike the main view, it must not wait for the previous line's tail/overlap window.
    let miniBarIndex = -1;
    for (let i = this.lines.length - 1; i >= 0; i -= 1) {
      if (currentTime >= this.lines[i].time) {
        miniBarIndex = i;
        break;
      }
    }

    if (miniBarIndex >= 0) {
      const rawMiniLine = this.lines[miniBarIndex];
      let miniLine = rawMiniLine;
      let nextLine = this.lines[miniBarIndex + 1];
      let isInterlude = !!(rawMiniLine?.isInterlude || rawMiniLine?.text === '...');
      let targetStartTime = rawMiniLine?.end || rawMiniLine?.time || 0;

      // 若当前行是间奏占位行，将桌面歌词要显示的 text 自动升格指向下一句要唱的真实歌词
      if (isInterlude) {
        for (let k = miniBarIndex + 1; k < this.lines.length; k++) {
          if (!this.lines[k].isInterlude && this.lines[k].text !== '...') {
            miniLine = this.lines[k];
            nextLine = this.lines[k + 1] || null;
            targetStartTime = miniLine.time;
            break;
          }
        }
      }

      this.desktopLyricsController?.sync({
        text: this._getLineText(miniLine),
        translation: miniLine?.translation || '',
        nextText: nextLine ? this._getLineText(nextLine) : '',
        nextTranslation: nextLine?.translation || '',
        words: miniLine?.words || null,
        currentTime,
        lineStart: rawMiniLine?.time || 0,
        lineEnd: isInterlude ? targetStartTime : (miniLine?.end || 0),
        isInterlude,
      });
    }

    if (!this.isVisible) {
      if (miniBarIndex !== this.miniBarIndex) {
        this.updateBarLyrics(miniBarIndex);
        this.miniBarIndex = miniBarIndex;
      }
      if (miniBarIndex >= 0 && this.lines[miniBarIndex]) {
        const rawLineData = this.lines[miniBarIndex];
        let lineData = rawLineData;
        let isInterlude = !!(rawLineData?.isInterlude || rawLineData?.text === '...');
        let nextLine = this.lines[miniBarIndex + 1];
        let targetStartTime = rawLineData?.end || rawLineData?.time || 0;
        if (isInterlude) {
          for (let k = miniBarIndex + 1; k < this.lines.length; k++) {
            if (!this.lines[k].isInterlude && this.lines[k].text !== '...') {
              lineData = this.lines[k];
              nextLine = this.lines[k + 1] || null;
              targetStartTime = lineData.time;
              break;
            }
          }
        }
        if (!Array.isArray(lineData.charWords) || lineData.charWords.length === 0) {
          return;
        }
        this.syncBarSpans(null, lineData.charWords, currentTime);

        // 同步桌面歌词进度，直接克隆已经构建好的底栏迷你歌词 spans HTML
        if (this.desktopLyricsController) {
          const barLyricEl = document.getElementById('bar-lyric-text-1');
          const barHtml = barLyricEl?.innerHTML || '';
          const { charC, totalChars } = calculateKaraokePlayheadState(lineData.charWords, currentTime);
          this.desktopLyricsController.syncKaraokeProgress({
            html: barHtml,
            charC,
            totalChars,
            text: this._getLineText(lineData),
            translation: lineData.translation || '',
            nextText: nextLine ? this._getLineText(nextLine) : '',
            nextTranslation: nextLine?.translation || '',
            lineStart: isInterlude ? targetStartTime : (lineData.time || 0),
            isInterlude,
          });
        }
      }
      return;
    }

    if (!this._cachedAllLines) {
      this._cachedAllLines = Array.from(document.querySelectorAll('#lyrics-lines .lyrics-line'));
    }
    const allLines = this._cachedAllLines;
    const container = document.getElementById('lyrics-scroll');

    const viewActiveIndices = calculateViewActiveIndices(this.lines, currentTime);
    const viewActiveKey = viewActiveIndices.join(',');

    // Update scrolling position only when the actual anchor changes. A change
    // in the warmup/overlap window alone must not replay FLIP: when two lines
    // finish together their layout is already changing, and a second
    // measurement in the same transition causes a visible twitch.
    if (scrollIndex !== this.currentScrollIndex) {
      const isInitialPositioning = !this._hasPositionedCurrentLyrics;
      this.currentScrollIndex = scrollIndex;
      this._lastViewActiveKey = viewActiveKey;
      const wasConcurrent = (this._lastActiveIndicesKey || '').includes(',');
      const isConcurrentTransition = wasConcurrent || activeIndices.length > 1;
      
      if (scrollIndex >= 0 && allLines[scrollIndex]) {
        this.isAutoScrolling = true;
        const lineEl = allLines[scrollIndex];
        
        // 1. 更新边界
        this.updateSpacerHeights();
        
        // Align strictly to the current primary scroll line's offset to keep active lyrics in place
        const baseOffsetTop = lineEl.offsetTop;
        
        const containerHeight = container.clientHeight || container.getBoundingClientRect().height || 500;
        const alignOffset = preferences.scrollAlign;
        const topSpacerHeight = containerHeight * alignOffset;
        const targetOffset = baseOffsetTop - topSpacerHeight;
        
        const finalTargetOffset = clampScrollTop(container, targetOffset);
        
        // Use a synchronized offset and a single reflow for smooth scrolling.
        // Capture the old position before applying the synchronized transform.
        const startScrollTop = container.scrollTop;
        const delta = finalTargetOffset - startScrollTop;

        if (isInitialPositioning || Math.abs(delta) < 1) {
          container.scrollTop = finalTargetOffset;
          // No visible row travel is needed; release any completed row in
          // this same state update instead of leaving its scale latched.
          allLines.forEach((el, idx) => {
            if (idx < scrollIndex) {
              if (el._scaleReleaseTimer) {
                clearTimeout(el._scaleReleaseTimer);
                el._scaleReleaseTimer = null;
              }
              el.classList.remove('lyric-scale-leaving');
            }
          });
        } else {
          container.scrollTop = finalTargetOffset;

          const targetIdx = scrollIndex;
          const animatedRows = getAnimatedLyricRows(allLines, targetIdx, this._lastAnimatedScrollRows);
          const animatedElements = animatedRows.map(({ el }) => el);
          this._lastAnimatedScrollRows = new Set(animatedElements);

          // Fast consecutive phrases must finish their row motion before the
          // next phrase starts. A fixed 1.15 s transition gets interrupted
          // repeatedly on short lines and produces a visible catch-up jerk.
          let nextForegroundTime = Infinity;
          for (let nextIdx = targetIdx + 1; nextIdx < this.lines.length; nextIdx += 1) {
            const nextLine = this.lines[nextIdx];
            if (!nextLine.isBackground && !nextLine.isInterlude && nextLine.time > currentTime + 0.01) {
              nextForegroundTime = nextLine.time;
              break;
            }
          }
          const availableMotionTime = nextForegroundTime - currentTime;
          const motionDuration = Number.isFinite(availableMotionTime)
            ? Math.max(0.28, Math.min(1.15, availableMotionTime * 0.72))
            : 1.15;
          const opacityDuration = Math.max(0.24, Math.min(1.05, motionDuration * 0.92));
          const durationScale = motionDuration / 1.15;
          let largestDelay = 0;

          // Step A: freeze transitions and offset nearby lyric rows together.
          const rowFollowEnabled = preferences.rowFollowEnabled;
          animatedRows.forEach(({ el, index: idx }) => {
            if (el.classList.contains('is-interlude-line')) return;
            if (el.classList.contains('is-background-line')) {
              clearLyricRowAnimationState(el);
              return;
            }
            if (el.classList.contains('active') && idx !== targetIdx) {
              el.classList.add('lyric-scale-leaving');
            }
            if (el.classList.contains('has-translation') && idx === targetIdx) {
              const translationEl = el.querySelector('.lyrics-translation');
              if (translationEl) {
                const currentTranslationStyle = window.getComputedStyle(translationEl);
                translationEl.style.setProperty('--translation-brighten-from-color', currentTranslationStyle.color);
                translationEl.style.setProperty('--translation-brighten-from-opacity', currentTranslationStyle.opacity);
              }
              el.classList.add('translation-brightening-start');
              el.classList.remove('translation-brightening', 'translation-fading', 'translation-faded');
            }
            el.style.transition = 'none';
            el.style.transform = `translateY(${delta}px)`;
          });

          // Step B: trigger one container-wide reflow.
          void container.offsetHeight;

          // Step C: animate nearby rows back to their zero transform.
          animatedRows.forEach(({ el, index: idx }) => {
            if (el.classList.contains('is-interlude-line')) {
              // Interlude entry/exit is fully phased by CSS; do not override it
              // with the regular lyric-row FLIP transition.
              el.style.transition = '';
              el.style.transitionDelay = '';
            } else if (el.classList.contains('is-background-line')) {
              // Background rows are expandable slots attached to their main
              // line. Let max-height/padding collapse them in place; applying
              // the regular FLIP translate would make them jump elsewhere.
              clearLyricRowAnimationState(el);
            } else {
              let delay = 0;
              if (rowFollowEnabled && !isConcurrentTransition && idx !== targetIdx) {
                const dist = Math.abs(idx - targetIdx);
                if (idx > targetIdx) {
                  delay = Math.min(0.42, dist * 0.055) * durationScale;
                } else {
                  delay = Math.min(0.18, dist * 0.025) * durationScale;
                }
              }
              largestDelay = Math.max(largestDelay, delay);
              el.style.setProperty('--lyric-motion-duration', `${opacityDuration.toFixed(3)}s`);
              el.style.setProperty('--lyric-scale-duration', `${motionDuration.toFixed(3)}s`);
              // Row motion and fading progress together; depth blur still reacts quickly.
              el.style.transition = `transform ${motionDuration.toFixed(3)}s cubic-bezier(0.26, 1.12, 0.42, 1) ${delay.toFixed(3)}s, opacity ${opacityDuration.toFixed(3)}s cubic-bezier(0.2, 0, 0.2, 1) 0s, filter 0.32s ease 0s`;
              el.style.transform = 'translateY(0)';

              if (el.classList.contains('has-translation')) {
                if (idx === targetIdx - 1) {
                  el.classList.add('translation-fading');
                  el.classList.remove('translation-brightening-start', 'translation-brightening', 'translation-faded');
                } else if (idx === targetIdx) {
                  el.classList.add('translation-brightening');
                  el.classList.remove('translation-brightening-start', 'translation-fading', 'translation-faded');
                } else if (idx < targetIdx - 1) {
                  el.classList.add('translation-faded');
                  el.classList.remove('translation-brightening-start', 'translation-brightening', 'translation-fading');
                } else {
                  el.classList.remove('translation-brightening-start', 'translation-brightening', 'translation-fading', 'translation-faded');
                }
              }

              if (idx < targetIdx) {
                if (el._scaleReleaseTimer) {
                  clearTimeout(el._scaleReleaseTimer);
                  el._scaleReleaseTimer = null;
                }
                // Start scale restoration in the same frame as upward FLIP.
                el.classList.remove('lyric-scale-leaving');
                el.classList.add('past');
                el.classList.remove('active');
              } else if (idx === targetIdx) {
                el.classList.add('active');
                el.classList.remove('past');
              } else {
                el.classList.remove('active', 'past');
              }
            }
          });

          // Clear the previous cleanup timer before scheduling a new animation cleanup.
          clearTimeout(this._scrollCleanup);
          this._scrollCleanup = setTimeout(() => {
            animatedElements.forEach(el => {
              clearLyricRowAnimationState(el);
            });
            this._lastAnimatedScrollRows.clear();
            this.isAutoScrolling = false;
          }, Math.ceil((motionDuration + largestDelay) * 1000 + 180));
        }
        this._hasPositionedCurrentLyrics = true;
      }
    }

    const linesToProcess = calculateLinesToProcess(this.lines, currentTime, scrollIndex, activeIndices);

    // Update active/past visual classes, blur and clean up states based on dual axis sync (activeIndices + scrollIndex)
    const activeIndicesKey = activeIndices.join(',');
    const interludeVisualKey = this.lines.map((line, idx) => {
      if (!line.isInterlude) return '';
      const targetTime = line.end || line.endTime || (this.lines[idx + 1] ? this.lines[idx + 1].time - 0.3 : line.time + 5.0);
      if (currentTime < line.time) return 'future';
      if (currentTime < targetTime - 0.6) return 'active';
      if (currentTime < targetTime) return 'exiting';
      return 'past';
    }).join('|');
    if (activeIndicesKey !== this._lastActiveIndicesKey
      || scrollIndex !== this._lastVisualScrollIndex
      || interludeVisualKey !== this._lastInterludeVisualKey) {
      // Simple bottom bar lyric text update
      if (activeIndex !== this.activeIndex) {
        this.updateBarLyrics(activeIndex);
      }

      this.activeIndex = activeIndex;
      this._lastActiveIndicesKey = activeIndicesKey;
      this._lastVisualScrollIndex = scrollIndex;
      this._lastInterludeVisualKey = interludeVisualKey;
      
      const minActiveIdx = activeIndices.length > 0 ? Math.min(...activeIndices) : activeIndex;
      
      allLines.forEach((el, idx) => {
        const wasActive = el.classList.contains('active');
        const wasPast = el.classList.contains('past');
        const willBeActive = activeIndices.includes(idx);

        if (willBeActive) {
          if (el._scaleReleaseTimer) {
            clearTimeout(el._scaleReleaseTimer);
            el._scaleReleaseTimer = null;
          }
          el.classList.remove('lyric-scale-leaving');
        } else if (
          wasActive
          && !el.classList.contains('is-interlude-line')
          && !el.classList.contains('is-background-line')
        ) {
          // Keep the subtle active scale through the silent tail and the next
          // row's upward transition. Releasing it immediately when `active`
          // ends creates a visible shrink-before-scroll flash.
          if (el._scaleReleaseTimer) {
            clearTimeout(el._scaleReleaseTimer);
            el._scaleReleaseTimer = null;
          }
          el.classList.add('lyric-scale-leaving');
        }

        el.classList.remove(
          'active',
          'past',
          'past-old',
          'concurrent-active',
          'concurrent-lane-0',
          'concurrent-lane-1',
          'concurrent-lane-2',
          'concurrent-lane-3',
        );

        if (el.classList.contains('is-interlude-line')) {
          el.classList.remove('active', 'past', 'is-exiting');
          const lineData = this.lines[idx];
          const targetTime = lineData.end || lineData.endTime || (this.lines[idx + 1] ? this.lines[idx + 1].time - 0.3 : lineData.time + 5.0);
          const EXIT_DUR = 0.6;

          if (currentTime < lineData.time) {
            if (wasActive || wasPast) trackInterludeLayout(this);
            el._wasPast = false;
          } else if (currentTime >= lineData.time && currentTime < targetTime) {
            if (!wasActive) trackInterludeLayout(this);
            el._wasPast = false;
            if (currentTime >= targetTime - EXIT_DUR) {
              el.classList.add('active', 'is-exiting');
            } else {
              el.classList.add('active');
            }
          } else {
            const justEnteredPast = !el._wasPast;
            el.classList.add('past');
            el._wasPast = true;

            if (justEnteredPast) {
              trackInterludeLayout(this);
            }
          }
          return;
        }

        const effectiveActive = Math.max(activeIndex, scrollIndex);

        if (activeIndices.includes(idx)) {
          el.classList.add('active');
        } else if (idx < minActiveIdx && idx < effectiveActive) {
          el.classList.add('past');
        }

        updateInactiveLineFixedState({
          lineEl: el,
          lineIndex: idx,
          activeIndices,
          viewActiveIndices,
          linesToProcess,
          currentTime,
          minActiveIndex: minActiveIdx,
          scrollIndex,
          lines: this.lines,
        });
      });

      if (!this.isUserScrolling) {
        this.applyBlur(activeIndices, scrollIndex, allLines);
      }
    }

    // Word-level (or character-level) smooth physics for both active and upcoming lines
    this._frameCount = (this._frameCount || 0) + 1;
    
    linesToProcess.forEach(idx => {
      if (idx >= 0 && this.lines[idx].charWords && this.lines[idx].charWords.length > 0) {
        const lineData = this.lines[idx];
        const domLine = allLines[idx];
        if (domLine) {
          if (!domLine._wordSpans) {
            domLine._wordSpans = domLine.querySelectorAll('.lyrics-word');
          }
          const wordSpans = domLine._wordSpans;
          
          // Keep the main lyrics on the same per-character renderer as the
          // desktop lyrics. The row-aligned renderer can be used only after
          // its geometry and CSS contract are proven compatible with every
          // ruby/TTML layout; it must not replace the working karaoke path.
          
          const { charC, totalChars } = calculateKaraokePlayheadState(lineData.charWords, currentTime);

          if (idx === this.activeIndex) {
            const rawActiveData = lineData;
            let activeLineData = rawActiveData;
            let isInterlude = !!(rawActiveData?.isInterlude || rawActiveData?.text === '...');
            let nextLine = this.lines[idx + 1];
            let targetStartTime = rawActiveData?.end || rawActiveData?.time || 0;
            if (isInterlude) {
              for (let k = idx + 1; k < this.lines.length; k++) {
                if (!this.lines[k].isInterlude && this.lines[k].text !== '...') {
                  activeLineData = this.lines[k];
                  nextLine = this.lines[k + 1] || null;
                  targetStartTime = activeLineData.time;
                  break;
                }
              }
            }
            this.syncBarSpans(wordSpans, activeLineData.charWords || lineData.charWords, currentTime);
            if (this.desktopLyricsController) {
              const barLyricEl = document.getElementById('bar-lyric-text-1');
              this.desktopLyricsController.syncKaraokeProgress({
                html: barLyricEl?.innerHTML || '',
                charC,
                totalChars,
                text: this._getLineText(activeLineData),
                translation: activeLineData.translation || '',
                nextText: nextLine ? this._getLineText(nextLine) : '',
                nextTranslation: nextLine?.translation || '',
                lineStart: isInterlude ? targetStartTime : (activeLineData.time || 0),
                isInterlude,
              });
            }
          }

          if (!this.isVisible) {
            return;
          }

          const longIndices = collectLongGlowIndices(wordSpans);

          renderClassicCharProgress({
            wordSpans,
            charWords: lineData.charWords,
            currentTime,
            charC,
            totalChars,
          });

          renderWordMotionEffects({
            wordSpans,
            charWords: lineData.charWords,
            charC,
            currentTime,
            longIndices,
          });

        }
      }
    });
  }

  // Staggered scroll: break total scroll into steps with delays between each
  staggeredScrollTo(lineEl) {
    staggeredScrollToLine({
      lineEl,
      scrollTimers: this._scrollTimers,
      scrollAnimation: this._scrollAnim,
      setAutoScrolling: value => { this.isAutoScrolling = value; },
      setScrollTimers: value => { this._scrollTimers = value; },
      setScrollAnimation: value => { this._scrollAnim = value; },
    });
  }



  // Keep smoothScrollTo as fallback
  smoothScrollTo(lineEl) {
    smoothScrollToLine({
      lineEl,
      scrollAnimation: this._scrollAnim,
      setAutoScrolling: value => { this.isAutoScrolling = value; },
      setScrollAnimation: value => { this._scrollAnim = value; },
    });
  }

  show() {
    const panel = document.getElementById('lyrics-panel');
    if (panel) {
      // 清除内联 transform，让 CSS .active 类的 transform: translateY(0) 生效
      panel.style.transform = '';
      panel.classList.add('active');
    }
    this.isVisible = true;

    // Lazily load the heavy large cover art only when the panel is shown
    if (this.player.currentIndex >= 0) {
      const song = this.player.playlist[this.player.currentIndex];
      if (song) {
        const cover = getCoverSrc(song);
        const largeCoverEl = document.getElementById('lyrics-large-cover');
        if (largeCoverEl && largeCoverEl.src !== cover) {
          transitionContent(largeCoverEl, cover, true);
        }
      }
    }
    
    this.realign();
    setTimeout(() => {
      this.realign();
    }, 100);
    setTimeout(() => {
      this.realign();
    }, 650);
  }

  hide() {
    const panel = document.getElementById('lyrics-panel');
    if (panel) {
      panel.classList.remove('active');
      // 恢复内联 transform 确保面板隐藏（防止 CSS 缓存残留）
      panel.style.transform = 'translateY(100%)';
    }
    this.isVisible = false;
  }

  toggle() {
    if (this.isVisible) this.hide(); else this.show();
  }
}

// ══ Audio Player ══
const player = new PlaybackController({
  createLyricsController: (audioPlayer) => new LyricsController(audioPlayer),
});
configureThemePlayer(() => player);

// ══ Init ══
document.addEventListener('DOMContentLoaded', async () => {
  window.addEventListener('error', (event) => {
    alert(`JS 运行异常: ${event.message}\n文件: ${event.filename}\n行号: ${event.lineno}`);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const isStandaloneEditor = urlParams.get('window') === 'metadata-editor';

  if (isStandaloneEditor) {
    document.body.classList.add('standalone-editor');
  }

  // Show the main window after the DOM and styles are ready.
  if (!isStandaloneEditor) {
    try {
      const appWin = getCurrentWindow();
      if (appWin && typeof appWin.show === 'function') {
        appWin.show().catch((err) => {
          console.warn('[Window] show() is not allowed by Tauri permissions config:', err);
        });
      }
    } catch (e) {}
  }

  // 启动页关闭逻辑已移至默认字体下载处（splash 等待字体初始化完成后关闭）

  // Restore the saved theme, using light mode on first launch.
  let savedTheme = localStorage.getItem('kimo-theme');
  if (!savedTheme) {
    savedTheme = 'light';
  }
  const isCustom = localStorage.getItem('kimo-overlay-opacity-custom') === 'true';
  let savedOp = isCustom ? localStorage.getItem('kimo-overlay-opacity') : null;
    applyTheme(savedTheme, savedOp);
  initLyricsTheme();
  // 加载已保存的 UI 风格
  const savedUiStyle = localStorage.getItem('kimo-ui-style') || 'solid';
  applyUiStyle(savedUiStyle);
  if (isStandaloneEditor) {
    window.addEventListener('storage', event => {
      if (event.key === 'kimo-ui-style' && event.newValue) {
        applyUiStyle(event.newValue);
      }
    });
  }
  // 加载已保存的背景样式
  const savedBgStyle = localStorage.getItem('kimo-bg-style') || 'static';
  applyBackgroundStyle(savedBgStyle);
  // 迁移旧设置：此前「背景透明度」存于 kimo-bg-custom-opacity（0-1 格式），
  // 迁移为整窗口透明度（0-100 格式，需 ×100；<0.1 视为测试残留，重置为 100 防卡死）
  if (localStorage.getItem('kimo-window-opacity') === null && localStorage.getItem('kimo-bg-custom-opacity') !== null) {
    const oldVal = parseFloat(localStorage.getItem('kimo-bg-custom-opacity'));
    const migrated = Number.isFinite(oldVal) && oldVal >= 0.1 ? Math.round(oldVal * 100) : 100;
    localStorage.setItem('kimo-window-opacity', String(migrated));
    localStorage.removeItem('kimo-bg-custom-opacity');
  }
  // 窗口透明度（整窗口概念，与背景设置无关）：启动时应用保存值；
  // 异常低值（<5）保护性重置为 100，避免 UI 完全不可见无法操作
  const savedWindowOpacity = localStorage.getItem('kimo-window-opacity');
  const parsedOpacity = savedWindowOpacity !== null && Number.isFinite(parseFloat(savedWindowOpacity))
    ? parseFloat(savedWindowOpacity)
    : 100;
  if (parsedOpacity < 5) {
    localStorage.setItem('kimo-window-opacity', '100');
    applyWindowOpacity(100);
  } else {
    applyWindowOpacity(parsedOpacity);
  }
  // 窗口材质（Windows 系统级底座）：启动时应用保存值
  applyWindowMaterial(localStorage.getItem('kimo-window-material') || 'none');
  initializeMaterialEngine();
  // 内置字体（生产环境 resources 目录）+ 用户字体（注册表）注册，随后应用存储的字体
  await Promise.allSettled([ensureBuiltinFonts(), ensureUserFonts()]);
  applyStoredInterfaceFont();
  applyStoredLyricsFont();

  // 默认字体（思源黑体）首次启动自动下载：不进安装包，未安装时在启动页展示下载进度
  const splashEl = document.getElementById('app-splash-screen');
  const splashStatusText = document.getElementById('splash-status-text');
  const hideSplash = () => {
    if (!splashEl) return;
    splashEl.classList.add('fade-out');
    setTimeout(() => splashEl.remove(), 500);
  };

  const defaultFontDownload = ensureDefaultFont({
    onProgress: (p) => {
      const pct = Math.round(p.percent || 0);
      if (splashStatusText) {
        splashStatusText.textContent = `正在下载默认字体（思源黑体）… ${pct}%`;
      }
    },
  });

  // 首帧渲染后：若无需下载（字体已安装），按时关闭启动页；
  // 若正在下载默认字体，启动页保持展示进度，完成后短暂提示再关闭
  setTimeout(async () => {
    // 首次启动的字体下载不能阻塞播放器初始化。网络不可用或请求卡住
    // 时先进入主界面，字体下载 Promise 仍会在后台完成并缓存结果。
    const downloaded = await Promise.race([
      defaultFontDownload,
      new Promise(resolve => setTimeout(() => resolve(false), 12000)),
    ]);
    if (downloaded) {
      if (splashStatusText) splashStatusText.textContent = '默认字体下载完成，正在启动…';
      setTimeout(hideSplash, 500);
    } else {
      hideSplash();
    }
  }, 600);

  if (localStorage.getItem('kimo-performance-mode') === 'true') {
    document.body.classList.add('perf-mode');
  }

  if (isStandaloneEditor) {
    // The metadata editor is already sized as a dedicated window. Inheriting
    // the main player's UI zoom leaves unused space on the right and bottom.
    document.documentElement.style.setProperty('--ui-scale', '1');
    document.documentElement.style.zoom = '1';
  } else {
    let savedScale = parseFloat(localStorage.getItem('kimo-ui-scale')) || 1.0;
    if (savedScale > 1.2) {
      savedScale = 1.2;
      localStorage.setItem('kimo-ui-scale', '1.2');
    }
    document.documentElement.style.setProperty('--ui-scale', savedScale.toString());
    document.documentElement.style.zoom = savedScale.toString();
  }

  // Lyrics depth-of-field blur toggle.
  const blurBtn = document.getElementById('btn-blur-toggle');
  const blurVal = document.getElementById('lyric-blur-value');
  const updateBlurUI = () => {
    const isEnabled = getLyricsPreferences().blurEnabled;
    const activeIcon = blurBtn?.querySelector('.blur-active-icon');
    const inactiveIcon = blurBtn?.querySelector('.blur-inactive-icon');
    if (isEnabled) {
      if (activeIcon) activeIcon.style.display = 'block';
      if (inactiveIcon) inactiveIcon.style.display = 'none';
      if (blurVal) blurVal.textContent = '景深模糊: 已开启';
    } else {
      if (activeIcon) activeIcon.style.display = 'none';
      if (inactiveIcon) inactiveIcon.style.display = 'block';
      if (blurVal) blurVal.textContent = '景深模糊: 已关闭';
    }
  };
  if (blurBtn) {
    blurBtn.addEventListener('click', () => {
      const isEnabled = getLyricsPreferences().blurEnabled;
      const nextState = !isEnabled;
      player.lyrics.setBlurEnabled(nextState);
      updateBlurUI();
    });
    updateBlurUI();
  }

  // Ruby position toggle (注音位置: 上方/下方).
  const rubyPosBtn = document.getElementById('btn-ruby-pos-toggle');
  const rubyPosVal = document.getElementById('lyric-ruby-pos-value');
  const lyricsPanel = document.querySelector('.lyrics-panel');
  const updateRubyPosUI = () => {
    const pos = getLyricsPreferences().rubyPosition || 'above';
    const aboveSpan = rubyPosBtn?.querySelector('.ruby-pos-above');
    const belowSpan = rubyPosBtn?.querySelector('.ruby-pos-below');
    const isBelow = pos === 'below';
    if (aboveSpan) aboveSpan.style.display = isBelow ? 'none' : '';
    if (belowSpan) belowSpan.style.display = isBelow ? '' : 'none';
    if (rubyPosVal) rubyPosVal.textContent = isBelow ? '注音: 下方' : '注音: 上方';
    if (lyricsPanel) {
      lyricsPanel.setAttribute('data-ruby-position', pos);
    }
  };
  if (rubyPosBtn) {
    rubyPosBtn.addEventListener('click', () => {
      const currentPos = getLyricsPreferences().rubyPosition || 'above';
      const nextPos = currentPos === 'above' ? 'below' : 'above';
      updateLyricsPreference('rubyPosition', nextPos);
      updateRubyPosUI();
    });
    updateRubyPosUI();
  }
  // ══ 监听子窗口元数据/歌词修改保存事件 ══
  initializeImmersiveMode();


  // Handle window resizing to dynamically recalibrate lyric spacers with high precision
  window.addEventListener('resize', () => {
    if (player.lyrics) {
      player.lyrics.resetAlignmentCache();
    }
    if (player.lyrics.isVisible) {
      player.lyrics.realign();
      requestAnimationFrame(() => {
        if (player.lyrics.isVisible) {
          player.lyrics.realign();
        }
      });
    }
  });

  // scroll-fix 已移除：手动 scrollTop += deltaY 会覆盖浏览器原生平滑滚动，导致顿挫感

  initializePlayerControls(player);

  initializeProgressScrubbing(player);
  initializeVolumeControls(player);

  const keyboardShortcuts = createKeyboardShortcutManager({
    player,
    switchTab: tabName => switchTab(tabName),
    showToast,
  });

  // Theme
  document.getElementById('theme-toggle')?.addEventListener('click', cycleTheme);

  initializeLyricsPreferencesControls(player);

  // Render Playlist Helper
  
  // Get audio quality label from metadata
  const getAudioQualityLabel = (song) => {
    const bitrate = song.bitrate;
    const sampleRate = song.sample_rate;
    const ext = (song.file_path || '').split('.').pop().toLowerCase();
    
    // Determine format
    let format = ext.toUpperCase();
    if (['flac', 'ape', 'wav', 'aiff', 'alac'].includes(ext)) format = 'Hi-Res';
    else if (ext === 'mp3') format = 'MP3';
    else if (ext === 'aac' || ext === 'm4a') format = 'AAC';
    else if (ext === 'ogg') format = 'OGG';
    else if (ext === 'wma') format = 'WMA';
    
    // Determine quality tier
    let quality = '';
    if (bitrate) {
      if (bitrate >= 3200) quality = 'SQ'; // 320kbps+
      else if (bitrate >= 2560) quality = 'HQ'; // 256kbps
      else if (bitrate >= 1920) quality = 'HQ'; // 192kbps
      else quality = '标准';
    }
    
    // For lossless formats
    if (['flac', 'ape', 'wav', 'aiff', 'alac'].includes(ext)) {
      quality = '无损';
      if (sampleRate && sampleRate >= 96000) quality = 'Hi-Res';
    }
    
    return { format, quality, bitrate, sampleRate };
  };
  // Get audio quality HTML string
  const getAudioQualityHtml = (song) => {
    const q = getAudioQualityLabel(song);
    let html = '<span class="audio-tag format">' + q.format + '</span>';
    if (q.quality) {
      html += '<span class="audio-tag quality">' + q.quality + '</span>';
    }
    if (q.bitrate) {
      html += '<span class="audio-tag bitrate">' + Math.round(q.bitrate/10) + 'k</span>';
    }
    return html;
  };


  const renderPlaylist = (playlist) => {
    const listEl = document.getElementById('music-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    playlist.forEach((song, idx) => {
      const div = document.createElement('div');
      const isCurrent = idx === player.currentIndex;
      div.className = `song-item${isCurrent ? ' playing' : ''}`;
      div.setAttribute('data-file-path', song.file_path);
      div.dataset.cover = song.cover_image || '';
      div.dataset.album = song.album || '';
      div.dataset.duration = String(song.duration || 0);
      const coverSrc = getCoverSrc(song);
      
      const isPaused = player.audio.paused;
      div.innerHTML = `
        <img src="${coverSrc}" class="song-cover" />
        <div class="song-info">
          <div class="song-title">${song.title || 'Unknown'}</div>
          <div class="song-artist">${renderArtistWithBadgesHtml(song.artist, song)}</div>
        </div>
        <div class="eq-animation ${isPaused ? 'paused' : ''}">
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
        </div>
        <div class="song-duration">${song.duration ? Math.floor(Math.round(song.duration) / 60) + ':' + (Math.round(song.duration) % 60).toString().padStart(2, '0') : ''}</div>
      `;
      div.addEventListener('click', () => {
        if ((localStorage.getItem('kimo-song-play-mode') || 'single') === 'single') player.play(idx);
      });
      div.addEventListener('dblclick', () => {
        if ((localStorage.getItem('kimo-song-play-mode') || 'single') === 'double') player.play(idx);
      });
      listEl.appendChild(div);
    });
  };

    // Background load missing covers & bitrate from metadata on startup (avoids writing MBs to localStorage)
  const backgroundLoadCovers = async (playlist) => {
    await new Promise(r => setTimeout(r, 1200));
    if (!playlist || playlist.length === 0) return;

    const CONCURRENCY_LIMIT = 2; // Limit metadata work to reduce CPU and disk pressure.
    const queue = [...playlist.entries()];

    const worker = async () => {
      let count = 0;
      while (queue.length > 0) {
        const [index, song] = queue.shift();
        count++;
        // Yield briefly after each metadata batch so the UI remains responsive.
        if (count % 2 === 0) {
          await new Promise(r => setTimeout(r, 40));
        }

        // Load if missing cover OR missing bitrate (for cached songs from old slimPlaylist)
        const needsCover = song.cover_image === undefined || song.cover_image === null;
        const needsBitrate = song.bitrate === undefined || song.bitrate === null;
        if (needsCover || needsBitrate) {
          try {
            const meta = await invoke('read_audio_metadata', { path: song.file_path });
            if (needsBitrate && meta && meta.bitrate) {
              song.bitrate = meta.bitrate;
            }
            song.cover_image = (meta && meta.cover_image) ? meta.cover_image : null;
            if (meta && meta.cover_image) {
              playlist[index] = song;

              // Dynamically update the cover image in the playlist DOM
              const songItems = document.querySelectorAll('.song-item');
              if (songItems[index]) {
                const coverImg = songItems[index].querySelector('.song-cover');
                if (coverImg) {
                  coverImg.src = getCoverSrc(song);
                }
              }

              // Update the active player UI covers if this song happens to be the active one
              if (index === player.currentIndex) {
                player.updateUI(song);
                extractDominantColor(getCoverSrc(song), getColorOptions()).then(color => {
                  song.dominant_color = color;
                  if (index === player.currentIndex) {
                    applyDynamicColor(color.r, color.g, color.b, getCoverSrc(song));
                  }
                });
              }
            }
            // If bitrate was loaded but cover was already set, still update playlist ref
            if (needsBitrate && !needsCover) {
              playlist[index] = song;
              // Update DOM for bitrate display
              const songItems = document.querySelectorAll('.song-item');
              if (songItems[index]) {
                const tagEl = songItems[index].querySelector('.song-audio-tags');
                if (tagEl) {
                  tagEl.innerHTML = getAudioQualityHtml(song);
                }
              }
            }
          } catch (err) {
            console.error('Failed to background load cover for:', song.file_path, err);
            song.cover_image = null;
          }
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, playlist.length) }, worker);
    await Promise.all(workers);
  };

  // ══ Tab Management and Navigation System ══
  let currentTab = 'discover';

  // The local library is independent from the current playback queue.
  let musicLibrary = [];

  // ══ Tab Sub-States for Local Library & Helper Functions ══
  const {
    renderLocalMusicTab,
    playSongCollection,
  } = createLocalLibraryPage({
    player,
    getCoverSrc,
    getMusicLibrary: () => musicLibrary,
    getCurrentTab: () => currentTab,
    renderRecentPlaysTab: () => renderRecentPlaysTab(),
    showToast,
    switchTab: tabName => switchTab(tabName),
  });

  // Custom dialogs replace native prompt/confirm UI inside the WebView.
  // ========== 歌单模块 (1.3) ==========
  getLikedPlaylist();

  const toggleLikeSong = (songData) => {
    const filePath = songData.file_path || songData.path || '';
    const likedNow = toggleLikedSong(songData);
    updateHeartButton();
    showToast(likedNow ? '已添加到我喜欢' : '已从我喜欢移除');
  };

  const updateHeartButton = () => {
    const outline = document.getElementById('like-icon-outline');
    const filled = document.getElementById('like-icon-filled');
    if (!outline || !filled) return;
    try {
      const track = (player.currentIndex >= 0 && player.playlist) ? player.playlist[player.currentIndex] : null;
      const filePath = track?.file_path || track?.path || '';
      const liked = filePath ? isSongLiked(filePath) : false;
      outline.style.display = liked ? 'none' : '';
      filled.style.display = liked ? '' : 'none';
    } catch (_) {
      outline.style.display = '';
      filled.style.display = 'none';
    }
  };

  // Listen for metadata/lyrics saves from the standalone editor after dependencies are initialized.
  if (!isStandaloneEditor) {
    initializeMetadataSavedSync({
      player,
      renderPlaylist,
      updateHeartButton,
      showToast,
      getCoverSrc,
      extractDominantColor,
      applyDynamicColor,
      getDefaultDynamicColor,
      getColorOptions,
    });
  }

  document.getElementById('like-btn')?.addEventListener('click', () => {
    try {
      const track = (player.currentIndex >= 0 && player.playlist) ? player.playlist[player.currentIndex] : null;
      if (!track) { showToast('暂无播放歌曲'); return; }
      const songData = {
        file_path: track.file_path || track.path || '',
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        duration: track.duration || 0,
        cover_image: track.cover_image || '',
      };
      toggleLikeSong(songData);
    } catch (e) { showToast('操作失败'); }
  });

    initializePlaylistPanel({ player, getCoverSrc, showToast });

  // 评论面板按钮
  document.getElementById('comments-toggle-btn')?.addEventListener('click', () => {
    const track = (player.currentIndex >= 0 && player.playlist) ? player.playlist[player.currentIndex] : null;
    toggleCommentsPanel(player, track?.album || '');
  });

  let desktopLyrics = null;
  if (!isStandaloneEditor) {
    desktopLyrics = createDesktopLyricsController({ showToast, player });
    desktopLyrics.setPlayer(player);
    configureThemeDesktopLyrics(() => desktopLyrics);
    player.lyrics?.setDesktopLyricsController(desktopLyrics);
    player.audio?.addEventListener('play', () => desktopLyrics.notifyPlaybackState(true));
    player.audio?.addEventListener('pause', () => desktopLyrics.notifyPlaybackState(false));
    if (localStorage.getItem('kimo-desktop-lyrics-enabled') === 'true') {
      desktopLyrics.setVisible(true, { silent: true });
    }
  }

  // ══ 系统托盘状态同步 ══
  const syncTrayState = () => {
    const song = (player.currentIndex >= 0 && player.playlist[player.currentIndex]) || null;
    const songInfo = song ? `${song.title || '未知标题'} - ${song.artist || '未知歌手'}` : null;
    const lyricsEnabled = localStorage.getItem('kimo-desktop-lyrics-enabled') === 'true';
    invoke('update_tray_info', {
      isPlaying: player.isPlaying,
      desktopLyricsEnabled: lyricsEnabled,
      songInfo,
    }).catch(() => {});

    // 同步给自定义 Web 托盘窗口
    if (song) {
      localStorage.setItem('kimo-tray-state', JSON.stringify({
        title: song.title || '未知标题',
        artist: song.artist || '未知歌手',
        coverSrc: getCoverSrc(song),
        isPlaying: player.isPlaying,
        playMode: player.playMode
      }));
    } else {
      localStorage.setItem('kimo-tray-state', JSON.stringify(null));
    }
  };

  // 监听托盘菜单事件 → 驱动播放控制
  listen('tray-play', () => { player.toggle(); }).catch(() => {});
  listen('tray-prev', () => { player.prev(); }).catch(() => {});
  listen('tray-next', () => { player.next(); }).catch(() => {});
  listen('tray-toggle-play-mode', () => { 
    player.cyclePlayMode(); 
    syncTrayState(); 
  }).catch(() => {});
  listen('tray-toggle-desktop-lyrics', () => {
    const enabled = localStorage.getItem('kimo-desktop-lyrics-enabled') !== 'true';
    desktopLyrics.setVisible(enabled);
    syncTrayState();
  }).catch(() => {});
  listen('tray-toggle-desktop-lyrics-lock', () => {
    emit('desktop-lyrics-action', { action: 'toggle-lock' }).catch(() => {});
  }).catch(() => {});
  listen('tray-open-settings', () => { switchTab('settings'); }).catch(() => {});

  // 播放状态变化 → 同步到托盘
  player.audio?.addEventListener('play', () => syncTrayState());
  player.audio?.addEventListener('pause', () => syncTrayState());

  // 切歌 → 自动更新评论面板 + 收藏按钮状态（通过自定义事件，比 audio.play 更可靠）
  window.addEventListener('kimo-song-changed', () => {
    updateCommentsPanel(player);
    updateHeartButton();
  });

  // 桌面歌词可见性变化 → 同步到托盘
  listen('desktop-lyrics-visibility-changed', () => { syncTrayState(); }).catch(() => {});

  // 初始同步一次
  syncTrayState();

  // 🌟 智能软件后台休眠系统 (Smart Background Sleep System) 🌟
  // 当软件最小化、切入后台或隐藏时，彻底暂停动画与无用重绘，拯救 CPU 与 GPU 显存
  document.addEventListener('visibilitychange', () => {
    const container = document.querySelector('.app-container');
    if (document.hidden) {
      container?.classList.add('app-paused-state');
      document.documentElement.style.setProperty('--bg-rotate-play-state', 'paused');
    } else {
      container?.classList.remove('app-paused-state');
      const currentBgStyle = localStorage.getItem('kimo-bg-style') || 'static';
      if (currentBgStyle === 'dynamic') {
        document.documentElement.style.setProperty('--bg-rotate-play-state', 'running');
      } else {
        document.documentElement.style.setProperty('--bg-rotate-play-state', 'paused');
      }
    }
  });

  // ========== 歌单 UI ==========
  const { renderPlaylistsTab } = createPlaylistsPage({
    player,
    getCoverSrc,
    showToast,
    customPrompt,
    customConfirm,
  });

    const renderSettingsTab = createSettingsPage({
    player,
    showToast,
    applyMiniLyricsTranslationSetting,
    applyTheme,
    applyLyricsTheme,
    applyUiStyle,
    applyBackgroundStyle,
    getCurrentTheme: () => currentTheme,
    customConfirm,
    clearLyricsDB,
    open,
    invoke,
    setMusicLibrary: library => {
      musicLibrary = library;
    },
    clearSearchCache: () => {
      searchController.clearCache();
    },
    resetDiscoverRecommendations: () => resetDiscoverRecommendations(),
    backgroundLoadCovers,
    desktopLyrics,
    switchTab: tabName => switchTab(tabName),
    reapplyCurrentColor,
    keyboardShortcuts,
  });

  const renderRecentPlaysTab = createRecentPlaysRenderer({
    player,
    getCoverSrc,
    isRecentTab: () => currentTab === 'recent',
  });

  const {
    renderDiscoverTab,
    resetRecommendations: resetDiscoverRecommendations,
  } = createDiscoverPage({
    player,
    getCoverSrc,
    getRecentPlays,
    switchTab: tabName => switchTab(tabName),
  });

  // ===== LunaBeat 局域网曲库 =====
  const ensureLunaBeatPage = () => {
    if (window.__lunaBeatPage) return Promise.resolve(window.__lunaBeatPage);
    const page = createLunaBeatPage({
      player,
      getCoverSrc,
      showToast,
      switchTab: tabName => switchTab(tabName),
      getCurrentTab: () => currentTab,
    });
    window.__lunaBeatPage = page;
    return Promise.resolve(page);
  };

              const updateSidebarIndicator = (activeNav) => {
    const indicator = document.getElementById('sidebar-indicator');
    if (!indicator || !activeNav) return;
    const container = activeNav.closest('.sidebar-nav-container');
    if (!container) return;
    // Use offsetTop for reliable positioning within the container
    let offsetTop = 0;
    let el = activeNav;
    while (el && el !== container) {
      offsetTop += el.offsetTop;
      el = el.offsetParent;
    }
    indicator.style.top = offsetTop + 'px';
    indicator.style.height = activeNav.offsetHeight + 'px';
  };

  const switchTab = (tabName) => {
    currentTab = tabName;
    document.getElementById('content-toolbar')?.replaceChildren();
    
    // Update sidebar navigation active classes
    document.querySelectorAll('.sidebar .nav-item').forEach(el => {
      el.classList.remove('active');
    });
    
    const activeNav = document.getElementById(`nav-${tabName}`);
    if (activeNav) activeNav.classList.add('active');
    if (activeNav) updateSidebarIndicator(activeNav);
    
    // Control visibility of individual floating actions
    const floatingActions = document.getElementById('floating-actions');
    const floatSearch = document.getElementById('float-search');
    const floatToTop = document.getElementById('float-to-top');
    const floatToPlaying = document.getElementById('float-to-playing');
    const isListTab = tabName === 'local' || tabName === 'recent' || tabName === 'playlists' || tabName === 'luna';
    floatingActions?.classList.toggle('visible', isListTab);
    if (floatSearch) floatSearch.style.display = isListTab ? 'flex' : 'none';
    if (floatToTop) floatToTop.style.display = isListTab ? 'flex' : 'none';
    if (floatToPlaying) floatToPlaying.style.display = isListTab ? 'flex' : 'none';
    
    // Change tab content area
    const contentTitle = document.getElementById('content-title');
    if (!contentTitle) return;
    
    if (tabName === 'discover') {
      contentTitle.innerText = '发现音乐';
      renderDiscoverTab();
    } else if (tabName === 'local') {
      contentTitle.innerText = '本地音乐';
      renderLocalMusicTab();
    } else if (tabName === 'recent') {
      contentTitle.innerText = '最近播放';
      renderRecentPlaysTab();
    } else if (tabName === 'search') {
      contentTitle.innerText = '全局搜索';
      renderSearchTab();
    } else if (tabName === 'playlists') {
      contentTitle.innerText = '我的歌单';
      renderPlaylistsTab();
    } else if (tabName === 'settings') {
      contentTitle.innerText = '系统设置';
      renderSettingsTab();
    } else if (tabName === 'luna') {
      contentTitle.innerText = '局域网 (LunaBeat)';
      if (window.__lunaBeatPage) {
        window.__lunaBeatPage.enter();
      } else {
        const listEl = document.getElementById('music-list');
        if (listEl) {
          renderLoadingPlaceholder(listEl, {
            title: '正在初始化局域网页面…',
            sub: '正在加载 LunaBeat 模块，请稍候',
          });
        }
        // 初始化 LunaBeat 页面
        ensureLunaBeatPage().then(() => {
          if (currentTab === 'luna' && window.__lunaBeatPage) {
            window.__lunaBeatPage.enter();
          }
        });
      }
    }

                        // Trigger fluid tab transition with hardware acceleration
    const listEl = document.getElementById('music-list');
    const toolbarEl = document.getElementById('content-toolbar');

    // Animate toolbar (filter tabs, search box, etc.)
    if (toolbarEl) {
      toolbarEl.classList.remove('page-enter');
      void toolbarEl.offsetWidth;
      toolbarEl.classList.add('page-enter');
      // Stagger toolbar children
      requestAnimationFrame(() => {
        const children = toolbarEl.children;
        Array.from(children).forEach((el, i) => {
          el.style.opacity = '0';
          el.style.transform = 'translate3d(0, 24px, 0)';
          el.style.transition = 'none';
          requestAnimationFrame(() => {
            el.style.transition = `opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1) ${0.06 + i * 0.08}s, transform 0.7s cubic-bezier(0.25, 0.1, 0.25, 1) ${0.06 + i * 0.08}s`;
            el.style.opacity = '1';
            el.style.transform = 'translate3d(0, 0, 0)';
          });
        });
      });
    }

    // Animate main content list
    if (listEl) {
      listEl.classList.remove('fade-in-up', 'page-enter');
      void listEl.offsetWidth; // Force reflow
      listEl.classList.add('page-enter');

      // Stagger float-up for list items in all tabs
      requestAnimationFrame(() => {
        const items = listEl.querySelectorAll('.song-item, .playlist-item, .search-result-item, .setting-group, .stat-card');
        items.forEach((el, i) => {
          el.style.opacity = '0';
          el.style.transform = 'translate3d(0, 24px, 0)';
          el.style.transition = 'none';
          requestAnimationFrame(() => {
            el.style.transition = `opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1) ${0.12 + i * 0.04}s, transform 0.7s cubic-bezier(0.25, 0.1, 0.25, 1) ${0.12 + i * 0.04}s`;
            el.style.opacity = '1';
            el.style.transform = 'translate3d(0, 0, 0)';
          });
        });
      });
    }
  };

  // Bind Switch Tab functions to global so player can refresh them
  window.addToRecentPlays = (song) => {
    addRecentPlay(song);
    
    // Dynamically update view if current active tab needs refresh
    if (currentTab === 'recent') {
      renderRecentPlaysTab();
    }
  };

  // Wire up sidebar navigation buttons
  document.getElementById('nav-discover')?.addEventListener('click', () => switchTab('discover'));
  document.getElementById('nav-local')?.addEventListener('click', () => switchTab('local'));
  document.getElementById('nav-luna')?.addEventListener('click', () => switchTab('luna'));
  document.getElementById('nav-recent')?.addEventListener('click', () => switchTab('recent'));
  document.getElementById('nav-search')?.addEventListener('click', () => switchTab('search'));
  document.getElementById('nav-playlists')?.addEventListener('click', () => switchTab('playlists'));
  document.getElementById('nav-settings')?.addEventListener('click', () => switchTab('settings'));
  // Initialize sliding indicator position
  setTimeout(() => {
    const activeNav = document.querySelector('.sidebar .nav-item.active');
    if (activeNav) updateSidebarIndicator(activeNav);
  }, 100);
  window.addEventListener('resize', () => {
    const activeNav = document.querySelector('.sidebar .nav-item.active');
    if (activeNav) updateSidebarIndicator(activeNav);
  });

  // 与评论区、播放列表一样挂到 body 顶层，让玻璃按钮直接采样整页背景。
  const floatingActions = document.getElementById('floating-actions');
  if (floatingActions && floatingActions.parentElement !== document.body) {
    document.body.appendChild(floatingActions);
  }
  floatingActions?.classList.remove('visible');

  // Wire up list floating actions
  document.getElementById('float-to-top')?.addEventListener('click', () => {
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
      contentArea.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.getElementById('float-to-playing')?.addEventListener('click', () => {
    const activeSong = document.querySelector('.song-item.playing');
    if (activeSong) {
      activeSong.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // Sidebar search and background caching.
  const searchController = createSearchController({
    player,
    workerSource: SEARCH_WORKER_SOURCE,
    loadLyricsCache: loadAllLyricsFromDB,
    saveLyricsCache: saveLyricsToDB,
    invoke,
    parseLRC,
    parseELRC,
    parseTTML,
    parseJSONLyrics,
    switchTab,
    getCoverSrc,
    showToast,
  });
  const { renderSearchTab } = searchController;

  // ══ Scanned Directories Initialization & Backward Compatibility ══
  try {
    const cachedDirs = localStorage.getItem('kimo-scanned-dirs');
    if (!cachedDirs) {
      const oldSingle = localStorage.getItem('kimo-scanned-dir');
      if (oldSingle) {
        localStorage.setItem('kimo-scanned-dirs', JSON.stringify([oldSingle]));
      }
    }
  } catch (e) {
    console.error('Failed to init scanned directories:', e);
  }

  // ══ SQLite 歌库加载（替代 localStorage）══
  try {
    await invoke('init_library_db');
    const dbSongs = await invoke('get_library_songs', { offset: 0, limit: 50000 });
    if (Array.isArray(dbSongs) && dbSongs.length > 0) {
      musicLibrary = dbSongs;
      if (player.playlist.length === 0) {
        player.playlist = [...dbSongs];
      }
      backgroundLoadCovers(musicLibrary);
      // SQLite 已接管歌库，清理 localStorage 中的旧版缓存，避免残留占满配额
      try {
        localStorage.removeItem('kimo-music-library');
      } catch (e) {}
    } else {
      // 回退：首次迁移，从 localStorage 旧缓存加载（后续扫描会写入 SQLite）
      const cachedLibrary = localStorage.getItem('kimo-music-library');
      if (cachedLibrary) {
        try {
          const parsed = JSON.parse(cachedLibrary);
          if (Array.isArray(parsed) && parsed.length > 0) {
            musicLibrary = parsed;
            if (player.playlist.length === 0) {
              player.playlist = [...parsed];
            }
            backgroundLoadCovers(musicLibrary);
          }
        } catch (e) {
          console.error('Failed to load cached music library from localStorage', e);
        }
      }
    }
  } catch (e) {
    console.error('Failed to load music library from SQLite, falling back to localStorage:', e);
    const cachedLibrary = localStorage.getItem('kimo-music-library');
    if (cachedLibrary) {
      try {
        const parsed = JSON.parse(cachedLibrary);
        if (Array.isArray(parsed) && parsed.length > 0) {
          musicLibrary = parsed;
          if (player.playlist.length === 0) {
            player.playlist = [...parsed];
          }
          backgroundLoadCovers(musicLibrary);
        }
      } catch (ex) {}
    }
  }

  if (musicLibrary.length === 0 && player.playlist.length > 0) {
    musicLibrary = [...player.playlist];
  }

  // 定期清理超过 12 个月的播放统计数据（此前从未执行，防止配额被历史数据占满）
  try {
    cleanupOldStats(12);
  } catch (e) {
    console.warn('[PlayStats] cleanup failed:', e);
  }

  // Restore last played song only in the main player window.
  if (!isStandaloneEditor) {
  try {
    const lastPlayedPath = localStorage.getItem('kimo-last-played-path');
    if (lastPlayedPath && player.playlist.length > 0) {
      const index = player.playlist.findIndex(s => s.file_path === lastPlayedPath);
      if (index >= 0) {
        const song = player.playlist[index];
        player.currentIndex = index;
        
        // Prevent Windows toast notification on startup
        player.lastNotifiedFilePath = song.file_path;
        
        // Update UI with last song
        player.updateUI(song);
        updateHeartButton();
        
        // Load audio source
        player.audio.src = convertFileSrc(song.file_path);
        
        // Load lyrics
        player.lyrics.load(song.file_path);
        
        // Restore progress position
        const savedTime = parseFloat(localStorage.getItem('kimo-last-played-time')) || 0;
        if (savedTime > 0) {
          player.pendingSeekTime = savedTime;
        }

        // Restore dynamic color background state
        const cachedColorStr = localStorage.getItem('kimo-last-dynamic-color');
        const cachedCoverSrc = localStorage.getItem('kimo-last-cover-src');
        if (cachedColorStr) {
          const [r, g, b] = cachedColorStr.split(',').map(Number);
          applyDynamicColor(r, g, b, cachedCoverSrc);
        } else {
          extractDominantColor(getCoverSrc(song), getColorOptions()).then(color => {
            song.dominant_color = color;
            if (player.currentIndex === index) {
              applyDynamicColor(color.r, color.g, color.b, getCoverSrc(song));
            }
          });
        }
        
        // Auto play if enabled
        const autoPlayOnStart = localStorage.getItem('kimo-auto-play-on-start') === 'true';
        if (autoPlayOnStart) {
          player.audio.play().catch(e => console.error('Autoplay on start failed:', e));
        }
      }
    }
  } catch (e) {
    console.error('Failed to restore last played song on startup:', e);
  }

  // Switch to discover homepage on startup!
  switchTab('discover');
  }

  // Desktop audio-file drag and drop playback.
  // 1. 拦截原生拖放以屏蔽Webview 默认页面跳转行为
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  const playDroppedFile = async (filePath) => {
    try {
      console.log('[Drag Drop] Handling dropped file path:', filePath);
      // 判断是否已经在播放列表中
      const existingIdx = player.playlist.findIndex(s => s.file_path === filePath);
      if (existingIdx !== -1) {
        console.log('[Drag Drop] File already in playlist, playing directly. Index:', existingIdx);
        player.play(existingIdx);
        return;
      }

      const meta = await invoke('read_audio_metadata', { path: filePath });
      const fileName = filePath.substring(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
      const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;

            const newSong = {
        file_path: filePath,
        title: meta?.title || nameWithoutExt,
        artist: meta?.artist || '未知艺术家',
        album: meta?.album || '未知专辑',
        duration: meta?.duration || 0,
        bitrate: meta?.bitrate || 0,
        cover_image: meta?.cover_image || null
      };

      // 追加到播放列表并重新渲染
      player.playlist.push(newSong);
      renderPlaylist(player.playlist);
      
      // 异步更新本地缓存（配额满时降级：剥离封面重试）
      try {
        localStorage.setItem('kimo-playlist-cache', JSON.stringify(player.playlist));
      } catch (e) {
        try {
          localStorage.setItem('kimo-playlist-cache', JSON.stringify(player.playlist.map((s) => ({ ...s, cover_image: undefined }))));
        } catch (e2) {
          console.warn('[PlaylistCache] 存储空间不足，播放列表缓存未保存');
        }
      }
      
      // 立即播放最后一首（即新拖入的这首）
      player.play(player.playlist.length - 1);
    } catch (err) {
      console.error('[Drag Drop] Failed to process dropped file:', err);
    }
  };

  // 2. 监听 Tauri 原生拖放事件
  try {
    if (window.__TAURI_INTERNALS__) {
      getCurrentWindow().listen('tauri://drag-drop', async (event) => {
        // payload 的格式类似于 { paths: ["C:\\path\\to\\music.mp3"] }
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          const musicExtensions = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma'];
          const audioFile = paths.find(p => musicExtensions.some(ext => p.toLowerCase().endsWith(ext)));
          if (audioFile) {
            await playDroppedFile(audioFile);
          } else {
            console.log('[Drag Drop] Dropped files do not contain supported audio formats:', paths);
          }
        }
      });
    } else {
      console.warn('[Drag Drop] Skipped listening to Tauri drag-drop events outside Tauri.');
    }
  } catch (e) {
    console.error('[Drag Drop] Failed to listen to tauri drag-drop events:', e);
  }

  // OS 文件关联：监听单实例模式下双击音频文件打开的事件
  listen('open-file', (event) => {
    const filePath = event.payload;
    if (filePath) {
      console.log('[File Assoc] Opening file via OS association:', filePath);
      playDroppedFile(filePath);
    }
  }).catch(() => {});

  // OS 文件关联：首次启动时检查是否通过双击音频文件启动
  if (window.__TAURI_INTERNALS__) {
    invoke('take_pending_file').then((pendingFile) => {
      if (pendingFile) {
        console.log('[File Assoc] Launching with pending file:', pendingFile);
        playDroppedFile(pendingFile);
      }
    }).catch((err) => {
      console.warn('[File Assoc] Failed to check pending file:', err);
    });
  }

  // Custom context menu for song list, album cards, etc.
  initializeCustomContextMenu({
    player,
    showToast,
    switchTab: tabName => switchTab(tabName),
    playSongCollection,
    openMetadataEditor: filePath => openMetadataEditor(filePath),
  });

  let bubbleEditor = document.getElementById('word-bubble-editor');
  if (!bubbleEditor) {
    bubbleEditor = document.createElement('div');
    bubbleEditor.id = 'word-bubble-editor';
    bubbleEditor.className = 'word-bubble-editor';
    bubbleEditor.innerHTML = `
      <div class="bubble-group">
        <label>开始时间</label>
        <input type="text" class="bubble-input start" placeholder="00:00.000" />
      </div>
      <div class="bubble-group">
        <label>原文 / 译文</label>
        <input type="text" class="bubble-input text" placeholder="歌词文本" />
      </div>
      <div class="bubble-group">
        <label>结束时间</label>
        <input type="text" class="bubble-input end" placeholder="00:00.000" />
      </div>
    `;
    document.body.appendChild(bubbleEditor);
    
    // 全局点击自动关闭气泡
    document.addEventListener('click', (e) => {
      if (!bubbleEditor.classList.contains('active')) return;
      if (bubbleEditor.contains(e.target) || e.target.closest('.word-unit-card')) {
        return;
      }
      bubbleEditor.classList.remove('active');
      document.querySelectorAll('.word-unit-card.active').forEach(c => c.classList.remove('active'));
    });
  }

  const parseLyricsFromRawText = (rawText) => {
    const { type, lyrics } = parseEditableLyrics(rawText);
    currentLyricsType = type;
    return lyrics;
  };

  const renderLyricsTimeline = (lyricsList) => {
    renderMetadataLyricsTimeline({
      lyricsList,
      bubbleEditor,
    });
    const formatBadge = document.getElementById('lyrics-format-badge');
    if (formatBadge) {
      const formatLabels = {
        ttml: 'TTML',
        json: '逐字 JSON',
        'word-lrc': '逐字 LRC',
        'enhanced-lrc': 'ELRC 逐字歌词',
        lrc: 'LRC',
      };
      formatBadge.textContent = formatLabels[currentLyricsType] || currentLyricsType.toUpperCase();
      formatBadge.dataset.format = currentLyricsType;
    }
  };

  const serializeLyricsFromWorkspace = () => serializeEditableLyrics({
    lyricsList: currentEditableLyrics,
    lyricsType: currentLyricsType,
  });

  const bindMetadataLyricsControls = () => bindLyricsEditorControls({
    openFile: options => open(options),
    readTextFile: path => invoke('read_text_file', { path }),
    parseLyrics: parseLyricsFromRawText,
    renderTimeline: renderLyricsTimeline,
    serializeWorkspace: serializeLyricsFromWorkspace,
    showToast,
    getLyrics: () => currentEditableLyrics,
    setLyrics: lyrics => { currentEditableLyrics = lyrics; },
    getLyricsType: () => currentLyricsType,
    getEditorMode: () => currentLyricsEditorMode,
    setEditorMode: mode => { currentLyricsEditorMode = mode; },
  });

  const bindMetadataCoverControls = (fallbackCoverSrc) => bindCoverControls({
    openFile: options => open(options),
    convertFileSrc,
    fallbackCoverSrc,
    showToast,
  });

  const openInlineMetadataEditor = async (filePath) => {
    const modal = document.getElementById('metadata-editor-modal');
    if (!modal) return;

    document.body.classList.add('metadata-editor-open');
    modal.style.display = 'flex';
    modal.classList.add('active');

    bindMetadataCoverControls(getCoverSrc(null));
    bindMetadataLyricsControls();

    try {
      const meta = await invoke('read_audio_metadata', { path: filePath });
      fillMetadataForm({ meta, filePath, getCoverSrc });

      const lyrRes = await invoke('get_lyrics', { audioPath: filePath });
      const lyricsContent = lyrRes?.content || '';
      currentLyricsEditorMode = 'timeline';

      const rawContainer = document.getElementById('lyrics-editor-raw-container');
      const viewport = document.getElementById('lyrics-editor-viewport');
      if (rawContainer) rawContainer.style.display = 'none';
      if (viewport) viewport.style.display = 'block';

      const rawToggleBtn = document.getElementById('btn-lyrics-raw-toggle');
      if (rawToggleBtn) rawToggleBtn.textContent = '查看原始文本';

      const list = parseLyricsFromRawText(lyricsContent);
      currentEditableLyrics = list;
      renderLyricsTimeline(list);

      const addLineBtn = document.getElementById('btn-lyrics-add-line');
      if (addLineBtn) {
        addLineBtn.style.display = currentLyricsType === 'lrc' ? 'inline-block' : 'none';
      }

      const lyricsTextarea = document.getElementById('edit-metadata-lyrics');
      if (lyricsTextarea) {
        lyricsTextarea.value = lyricsContent;
        lyricsTextarea.dataset.workspaceSnapshot = serializeLyricsFromWorkspace();
      }
    } catch (error) {
      console.error('[MetadataEditor] Failed to load inline editor:', error);
      showToast('无法读取歌曲信息');
    }
  };

  const openMetadataEditor = async (filePath) => {
    const normalizedPath = typeof filePath === 'string' ? filePath.trim() : '';
    if (!normalizedPath) {
      showToast('无法打开编辑器：未获取到歌曲文件路径');
      return;
    }

    try {
      await invoke('open_metadata_editor_window', { path: normalizedPath });
    } catch (e) {
      console.error('[MetadataEditor] Failed to open standalone window:', e);
      showToast(`无法打开独立编辑窗口：${String(e)}`);
    }
  };

  const closeMetadataEditor = () => {
    const modal = document.getElementById('metadata-editor-modal');
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => modal.style.display = 'none', 300);
    }
    document.body.classList.remove('metadata-editor-open');
    if (bubbleEditor) {
      bubbleEditor.classList.remove('active');
      document.querySelectorAll('.word-unit-card.active').forEach(c => c.classList.remove('active'));
    }
  };

  if (!isStandaloneEditor) {
    document.getElementById('metadata-editor-close')?.addEventListener('click', closeMetadataEditor);
    document.getElementById('metadata-editor-cancel')?.addEventListener('click', closeMetadataEditor);

    bindMetadataCoverControls("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='%23333'/></svg>");

    bindMetadataLyricsControls();

    document.getElementById('metadata-editor-save')?.addEventListener('click', async () => {
    const values = getMetadataFormValues({
      getLyricsValue: () => currentLyricsEditorMode === 'raw'
        ? document.getElementById('edit-metadata-lyrics').value
        : serializeLyricsFromWorkspace(),
    });
    const { filePath, title, artist, album, coverPath, removeCover } = values;

    if (!title) {
      showToast('歌曲标题不能为空');
      return;
    }

    setMetadataSaveBusy(true);

    try {
      await invoke('write_audio_metadata', toWriteMetadataPayload(values));

      const updatedMeta = await invoke('read_audio_metadata', { path: filePath });

      const songIdx = player.playlist.findIndex(s => s.file_path === filePath);
      if (songIdx !== -1) {
        const originalSong = player.playlist[songIdx];
        const updatedSong = {
          ...originalSong,
          title: updatedMeta.title || title,
          artist: updatedMeta.artist || artist || '未知歌手',
          album: updatedMeta.album || album || '未知专辑',
          cover_image: updatedMeta.cover_image || null,
        };

        if (coverPath || removeCover) {
          updatedSong.dominant_color = null;
        }

        player.playlist[songIdx] = updatedSong;

        try {
          localStorage.setItem('kimo-playlist-cache', JSON.stringify(player.playlist));
        } catch (e) {
          try {
            localStorage.setItem('kimo-playlist-cache', JSON.stringify(player.playlist.map((s) => ({ ...s, cover_image: undefined }))));
          } catch (e2) {
            console.warn('[PlaylistCache] 存储空间不足，播放列表缓存未保存');
          }
        }

        renderPlaylist(player.playlist);

        if (songIdx === player.currentIndex) {
          player.updateUI(updatedSong);
          updateHeartButton();
          if (player.lyrics && typeof player.lyrics.load === 'function') {
            await player.lyrics.load(filePath);
          }

          if (updatedSong.cover_image) {
            extractDominantColor(getCoverSrc(updatedSong), getColorOptions()).then(color => {
              updatedSong.dominant_color = color;
              if (player.currentIndex === songIdx) {
                applyDynamicColor(color.r, color.g, color.b, getCoverSrc(updatedSong));
              }
            });
          } else {
            const defColor = getDefaultDynamicColor();
            applyDynamicColor(defColor.r, defColor.g, defColor.b, getCoverSrc(null));
          }
        }
      }

      showToast('元数据与歌词修改并保存成功');
      closeMetadataEditor();
    } catch (err) {
      console.error('[MetadataEditor] Failed to save metadata:', err);
      showToast(`保存失败: ${err}`);
    } finally {
      setMetadataSaveBusy(false);
    }
    });
  }

  // Expose openMetadataEditor globally
  window.openMetadataEditor = openMetadataEditor;

  // ══ Album Cover Context Menu and Image View Modal ══
  initializeAlbumCoverMenu({
    player,
    getCoverSrc,
    showToast,
    openMetadataEditor: filePath => openMetadataEditor(filePath),
  });

  initializeLyricsSettingsToolbar();
  applyMiniLyricsTranslationSetting();

  // 应用动画速率设置
  applyAnimationSpeed();

  // 应用mini歌词字号设置
  const savedMiniLyricsSize = Math.max(11, Math.min(18, Number(localStorage.getItem('kimo-mini-lyrics-font-size') || 13.5)));
  document.documentElement.style.setProperty('--mini-lyrics-size', `${savedMiniLyricsSize.toFixed(1)}px`);

  // ── 材质引擎（架构落地 v1，docs/material-layer-architecture.md）──
  // 默认不激活：设置页「材质引擎预览」开关启用后，引擎接管背景层做玻璃效果
  function initializeMaterialEngine() {
    const materialRegistry = new MaterialRegistry();
    materialRegistry.register('frosted-glass', () => {
      // 按当前主题对齐评论区玻璃默认：浅色主题用浅色玻璃 + 更强高光
      const theme = localStorage.getItem('kimo-theme') || 'light';
      const isLight = theme === 'light' || theme === 'grey';
      const mat = new FrostedGlassMaterial();
      if (isLight) {
        mat.params.patch({ tintColor: 'rgba(245, 245, 247, 0.6)', tintAmount: 0.32, highlight: 0.85 });
      }
      return mat;
    });
    const materialEngine = new MaterialEngine(materialRegistry);
    const materialLayer = new MaterialLayer();
    materialEngine.addLayer('main', materialLayer);
    const materialThemeBridge = new MaterialThemeBridge();
    window.__materialEngine = { engine: materialEngine, layer: materialLayer, bridge: materialThemeBridge };

    /** 材质预览自动启用系统底座时记录（关闭时恢复 none） */
    let previewForcedMaterial = false;

    // 背景内容变化（切歌换封面）联动：叠加层无输入，仅触发重算
    window.__materialEngine.onBackgroundChanged = () => {
      materialLayer.invalidate();
    };
    window.__materialEngine.previewActive = false;

    function ensureMaterialPreviewCanvas() {
      let canvas = document.getElementById('material-preview-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'material-preview-canvas';
        // 材质层位于最底（Window → 材质层 → 背景层 → UI）：
        // 插到 dynamic-bg 之前（同 z-index 0，DOM 在前 → 在背景之下）
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;';
        const bg = document.getElementById('dynamic-bg');
        if (bg && bg.parentElement) {
          bg.parentElement.insertBefore(canvas, bg);
        }
      }
      return canvas;
    }

    function setMaterialPreview(enabled) {
      const bg = document.getElementById('dynamic-bg');
      const imgs = bg ? bg.querySelectorAll('.bg-blur-img') : [];
      window.__materialEngine.previewActive = !!enabled;
      if (enabled && materialLayer.stack.length === 0) {
        // 系统底座：若未启用窗口材质，自动用亚克力（DWM 模糊窗口后真实内容，无自反馈）
        if ((localStorage.getItem('kimo-window-material') || 'none') === 'none') {
          localStorage.setItem('kimo-window-material', 'acrylic');
          applyWindowMaterial('acrylic');
          previewForcedMaterial = true;
        }
        // 背景容器透明（CSS 规则：html[data-material-preview] .dynamic-bg 透明）——
        // 露出 DWM 材质（窗口背景）与叠加层
        document.documentElement.setAttribute('data-material-preview', 'true');
        // 材质层 = 叠加层：纯合成质感（着色/高光/噪点），半透明叠加在 DWM 材质上
        materialLayer.resize(Math.round(window.innerWidth * 0.5), Math.round(window.innerHeight * 0.5));
        materialLayer.setSource(null);
        materialLayer.stack.push(materialRegistry.create('glass-overlay'));
        materialEngine.onLayerOutput = (id, output) => {
          const canvas = ensureMaterialPreviewCanvas();
          canvas.width = output.width;
          canvas.height = output.height;
          canvas.getContext('2d').drawImage(output.canvas, 0, 0);
        };
        // 背景层隐藏（DWM 材质是唯一窗口底）
        for (const img of imgs) img.style.display = 'none';
        materialEngine.start();
      } else if (!enabled) {
        materialLayer.setSource(null);
        materialLayer.stack.clear();
        materialEngine.stop();
        materialEngine.onLayerOutput = null;
        document.documentElement.removeAttribute('data-material-preview');
        const canvas = document.getElementById('material-preview-canvas');
        if (canvas) canvas.remove();
        for (const img of imgs) img.style.display = '';
        // 恢复被预览自动启用的系统底座
        if (previewForcedMaterial) {
          localStorage.setItem('kimo-window-material', 'none');
          applyWindowMaterial('none');
          previewForcedMaterial = false;
        }
      }
    }
    window.__materialEngine.setPreview = setMaterialPreview;

    // 设置页切换「材质引擎预览」即时生效（storage 事件）
    window.addEventListener('storage', (e) => {
      if (e.key === 'kimo-material-engine-preview') {
        setMaterialPreview(e.newValue === 'true');
      }
    });
    setMaterialPreview(localStorage.getItem('kimo-material-engine-preview') === 'true');
  }

  // ── 开发者工具桥接：连续点击设置页「关于」卡片中的软件图标 5 次打开独立调试窗口，面板动作经事件桥转发 ──
  async function setupDebugWindowBridge() {
  let isOpeningDebugWindow = false; // 并发保护：创建完成前重复触发不再新建
  async function openDebugWindow() {
    if (isOpeningDebugWindow) return;
    isOpeningDebugWindow = true;
    try {
      try {
        const win = await WebviewWindow.getByLabel('debug');
        if (win) {
          await win.show();
          await win.setFocus();
          showToast('开发者工具已打开');
          return;
        }
      } catch (err) {
        console.error('[Debug] getByLabel failed:', err);
      }
      try {
        const newWin = new WebviewWindow('debug', { url: 'debug.html', title: '开发者工具', width: 480, height: 640 });
        newWin.once('tauri://created', () => {
          showToast('开发者工具已打开');
        });
        newWin.once('tauri://error', (e) => {
          console.error('[Debug] create window failed:', e);
          showToast('开发者工具打开失败：' + (e.payload || e));
        });
      } catch (err) {
        console.error('[Debug] create window threw:', err);
        showToast('开发者工具打开失败：' + err);
      }
    } finally {
      isOpeningDebugWindow = false;
    }
  }

  // 连续点击设置页「关于」卡片中的软件图标 5 次（2 秒窗口内）开启开发者工具。
  // 事件委托：设置页为动态渲染，.about-logo 渲染时机不定，委托到 document 最稳
  let debugIconClicks = 0;
  let debugIconTimer = null;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.about-logo')) return;
    debugIconClicks += 1;
    clearTimeout(debugIconTimer);
    debugIconTimer = setTimeout(() => { debugIconClicks = 0; }, 2000);
    if (debugIconClicks >= 5) {
      debugIconClicks = 0;
      clearTimeout(debugIconTimer);
      openDebugWindow();
    }
  });
    listen('debug-action', (event) => {
      const { action, value } = event.payload || {};
      switch (action) {
        case 'play-pause': if (player.audio.paused) player.audio.play(); else player.audio.pause(); break;
        case 'prev': player.previous?.(); break;
        case 'next': player.next?.(); break;
        case 'seek': if (player.audio.duration) {
          const v = Math.max(0, Math.min(1000, Number(value) || 0));
          player.audio.currentTime = (v / 1000) * player.audio.duration;
        } break;
        case 'speed': {
          const v = Math.max(0.25, Math.min(4, Number(value) || 1));
          player.audio.playbackRate = v;
        } break;
        case 'reload-audio': if (player.audio.src) { const t = player.audio.currentTime; player.audio.load(); player.audio.currentTime = t; } break;
        case 'immersive': (document.getElementById('immersive-toggle') || document.querySelector('[data-action="immersive"]'))?.click(); break;
        case 'desktop-lyrics': (document.getElementById('desktop-lyrics-toggle') || document.querySelector('[data-action="desktop-lyrics"]'))?.click(); break;
        case 'fullscreen': document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); break;
        case 'open-editor': window.openMetadataEditor?.(); break;
        case 'reload-main': location.reload(); break;
        case 'force-render': player.lyrics?.resetAlignmentCache?.(); player.lyrics?.render?.(); break;
        case 'realign': player.lyrics?.realign?.(); break;
        case 'view-full': player.lyrics?.viewFullLyrics?.(); break;
        case 'toggle-class': {
          // 白名单：仅接受调试面板发送的固定 class
          const allowlist = ['debug-show-bboxes', 'debug-no-animations', 'debug-show-lift', 'debug-no-blur', 'perf-mode'];
          const cls = event.payload.value?.cls;
          if (typeof cls === 'string' && allowlist.includes(cls)) {
            document.body.classList.toggle(cls, !!event.payload.value?.on);
          }
        } break;
      }
    });

    // 独立调试窗口修改 localStorage（主题/风格/背景等）后主窗口即时生效
    window.addEventListener('storage', (e) => {
      if (e.key === 'kimo-theme') applyTheme(e.newValue || 'dark');
      else if (e.key === 'kimo-ui-style') applyUiStyle(e.newValue || 'solid');
      else if (e.key === 'kimo-bg-style') applyBackgroundStyle(e.newValue || 'static');
      else if (e.key === 'kimo-lyrics-theme') applyLyricsTheme(e.newValue || 'dark');
      else if (e.key === 'kimo-performance-mode') document.body.classList.toggle('perf-mode', e.newValue === 'true');
    });
  }

  // 开发者工具：连续点击设置页「关于」卡片中的软件图标 5 次打开独立调试窗口
  setupDebugWindowBridge();

  showStartupUpdateAnnouncement();

  // 启动时延迟检查更新
  startupUpdateCheck();

  const closeStandaloneWindow = async () => {
    try {
      await invoke('close_window');
    } catch (error) {
      console.error('[MetadataEditor] Failed to close standalone window:', error);
    }
  };

  let standaloneEditorControlsBound = false;

  // Initialize the standalone metadata and lyrics editor after the main DOM bindings.
  const initStandaloneMetadataEditor = async (filePath) => {
    if (!filePath) {
      showToast('未提供歌曲路径');
      return;
    }

    const fileName = filePath.substring(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
    const filenameTip = document.getElementById('edit-metadata-filename-tip');
    if (filenameTip) filenameTip.textContent = `编辑歌曲: ${fileName}`;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setSrc = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.src = val;
    };

    setVal('edit-metadata-path', filePath);
    setSrc('edit-metadata-cover-preview', getCoverSrc(null));
    setVal('edit-metadata-cover-path', '');
    setVal('edit-metadata-remove-cover', 'false');

    setVal('edit-metadata-title', '');
    setVal('edit-metadata-artist', '');
    setVal('edit-metadata-album', '');
    setVal('edit-metadata-lyrics', '正在读取元数据与歌词...');

    if (!standaloneEditorControlsBound) {
      bindMetadataCoverControls(getCoverSrc(null));
      bindMetadataLyricsControls();

      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
      };

      document.getElementById('metadata-editor-save')?.addEventListener('click', async () => {
      const values = getMetadataFormValues({
        getLyricsValue: () => currentLyricsEditorMode === 'raw'
          ? getVal('edit-metadata-lyrics')
          : serializeLyricsFromWorkspace(),
      });
      const { filePath: currentFilePath, title, artist, album, coverPath, removeCover } = values;

      if (!title) {
        showToast('歌曲标题不能为空');
        return;
      }

      setMetadataSaveBusy(true);

      try {
        await invoke('write_audio_metadata', toWriteMetadataPayload(values));

        // 发送事件同步主窗口
        await emit('metadata-saved', {
          filePath: currentFilePath,
          title,
          artist: artist || '未知歌手',
          album: album || '未知专辑',
          coverPath,
          removeCover
        });

        showToast('修改保存成功');
        setTimeout(() => {
          closeStandaloneWindow();
        }, 300);
      } catch (err) {
        console.error('[MetadataEditor] Failed to save metadata:', err);
        showToast(`保存失败：${err}`);
      } finally {
        setMetadataSaveBusy(false);
      }
      });

      standaloneEditorControlsBound = true;
    }

    try {
      const meta = await invoke('read_audio_metadata', { path: filePath });
      fillMetadataForm({ meta, filePath, getCoverSrc });

      const lyrRes = await invoke('get_lyrics', { audioPath: filePath });
      let lyricsContent = '';
      if (lyrRes && lyrRes.content) {
        lyricsContent = lyrRes.content;
      }

            currentLyricsEditorMode = 'timeline';
      const rawContainer = document.getElementById('lyrics-editor-raw-container');
      const viewport = document.getElementById('lyrics-editor-viewport');
      if (rawContainer) rawContainer.style.display = 'none';
      if (viewport) viewport.style.display = 'block';
      const rawToggleBtn = document.getElementById('btn-lyrics-raw-toggle');
      if (rawToggleBtn) rawToggleBtn.textContent = '查看原始文本';

      const list = parseLyricsFromRawText(lyricsContent);
      currentEditableLyrics = list;
      renderLyricsTimeline(list);

      const addLineBtn = document.getElementById('btn-lyrics-add-line');
      if (addLineBtn) {
        addLineBtn.style.display = currentLyricsType === 'lrc' ? 'inline-block' : 'none';
      }

      const lyricsTextarea = document.getElementById('edit-metadata-lyrics');
      if (lyricsTextarea) {
        lyricsTextarea.value = lyricsContent;
        lyricsTextarea.dataset.workspaceSnapshot = serializeLyricsFromWorkspace();
      }
    } catch (e) {
      console.error('[MetadataEditor] Failed to fetch full metadata/lyrics on load:', e);
      const lyricsTextarea = document.getElementById('edit-metadata-lyrics');
      if (lyricsTextarea) lyricsTextarea.value = '';
    }
  };

  if (isStandaloneEditor) {
    const editorModal = document.getElementById('metadata-editor-modal');
    if (editorModal) {
      editorModal.style.display = 'flex';
      editorModal.classList.add('active', 'standalone-mode');
    }
    const appContainer = document.querySelector('.app-container');
    if (appContainer) appContainer.style.display = 'none';

    const dragRegion = document.querySelector('.metadata-window-drag-region');
    dragRegion?.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      getCurrentWindow().startDragging().catch((error) => {
        console.error('[MetadataEditor] Failed to start window drag:', error);
      });
    });

    const handleStandaloneClose = (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeStandaloneWindow();
    };
    document.getElementById('metadata-editor-close')?.addEventListener('click', handleStandaloneClose);
    document.getElementById('metadata-editor-cancel')?.addEventListener('click', handleStandaloneClose);

    initStandaloneMetadataEditor(urlParams.get('path'));

    getCurrentWindow().listen('load-metadata', (event) => {
      if (event.payload) initStandaloneMetadataEditor(event.payload);
    }).catch((error) => {
      console.error('[MetadataEditor] Failed to listen for metadata changes:', error);
    });

    // Standalone editor initialization ends here.
  }

});
// HMR refresh trigger
