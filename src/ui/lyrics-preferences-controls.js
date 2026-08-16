/** Update the CSS --slider-fill variable so the track gradient shows progress. */
function updateSliderFill(slider) {
  if (!slider) return;
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--slider-fill', `${pct}%`);
}

function bindPopoverWheel(slider, handler) {
  if (!slider) return;
  const popover = slider.closest('.slider-popover');
  const controlItem = popover?.closest('.lyrics-control-item') || slider.closest('.lyrics-control-item');
  const handleWheel = event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.deltaY === 0) return;
    handler(event);
  };

  // The trigger remains hovered while the cursor is on the toolbar button;
  // once the detached popover is entered, its own listener follows the node.
  // stopPropagation above prevents a nested popover event from firing twice.
  (popover || slider).addEventListener('wheel', handleWheel, { passive: false });
  if (controlItem) {
    controlItem.addEventListener('wheel', handleWheel, { passive: false });
  }
}

export function initializeLyricsPreferencesControls(player) {
  let currentFontSize = parseFloat(localStorage.getItem('kimo-lyrics-font-size')) || 22;
  const fontSizeSlider = document.getElementById('slider-font-size');
  const fontSizeValue = document.getElementById('lyric-font-size-value');

  const resetLyricsAlignment = () => {
    if (player?.lyrics) player.lyrics.resetAlignmentCache();
  };

  const syncLyricsToCurrentTime = () => {
    if (player?.lyrics && player.audio) {
      player.lyrics.syncToTime(player.audio.currentTime);
    }
  };

  const updateFontSize = (size) => {
    currentFontSize = Math.max(16, Math.min(48, size));
    document.documentElement.style.setProperty('--lyrics-font-size', `${currentFontSize}px`);
    if (fontSizeSlider) fontSizeSlider.value = currentFontSize;
    if (fontSizeValue) fontSizeValue.innerText = `字号: ${currentFontSize.toFixed(1)}px`;
    updateSliderFill(fontSizeSlider);
    resetLyricsAlignment();
  };

  if (fontSizeSlider) {
    fontSizeSlider.value = currentFontSize;
    fontSizeSlider.addEventListener('input', (e) => {
      updateFontSize(parseFloat(e.target.value));
    });
    fontSizeSlider.addEventListener('change', (e) => {
      localStorage.setItem('kimo-lyrics-font-size', parseFloat(e.target.value));
    });

    const handleFontSizeWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.5 : -0.5;
      const nextVal = Math.max(16, Math.min(48, currentFontSize + delta));
      updateFontSize(nextVal);
      localStorage.setItem('kimo-lyrics-font-size', nextVal);
    };
    bindPopoverWheel(fontSizeSlider, handleFontSizeWheel);
  }
  updateFontSize(currentFontSize);

  const savedLineSpacing = localStorage.getItem('kimo-lyrics-line-spacing');
  if (savedLineSpacing !== null && !isNaN(parseFloat(savedLineSpacing))) {
    document.documentElement.style.setProperty('--lyrics-line-spacing', parseFloat(savedLineSpacing));
  }

  let currentFontWeight = parseInt(localStorage.getItem('kimo-lyrics-font-weight'), 10) || 400;
  const fontWeightSlider = document.getElementById('slider-font-weight');
  const fontWeightValue = document.getElementById('lyric-font-weight-value');

  const getWeightLabel = (weight) => {
    if (weight < 250) return '极细';
    if (weight < 350) return '细';
    if (weight < 450) return '常规';
    if (weight < 550) return '中等';
    if (weight < 650) return '半粗';
    if (weight < 750) return '粗';
    return '极粗';
  };

  const updateFontWeight = (weight) => {
    currentFontWeight = Math.max(150, Math.min(900, weight));
    document.documentElement.style.setProperty('--lyrics-font-weight', currentFontWeight);
    if (fontWeightSlider) fontWeightSlider.value = currentFontWeight;
    if (fontWeightValue) fontWeightValue.innerText = `字重: ${getWeightLabel(currentFontWeight)} (${currentFontWeight})`;
    updateSliderFill(fontWeightSlider);
    resetLyricsAlignment();
  };

  if (fontWeightSlider) {
    fontWeightSlider.min = 150;
    fontWeightSlider.max = 900;
    fontWeightSlider.step = 1;
    fontWeightSlider.value = currentFontWeight;
    fontWeightSlider.addEventListener('input', (e) => {
      updateFontWeight(parseInt(e.target.value, 10));
    });
    fontWeightSlider.addEventListener('change', () => {
      localStorage.setItem('kimo-lyrics-font-weight', currentFontWeight);
    });

    const handleFontWeightWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 10 : -10;
      const nextWeight = Math.max(150, Math.min(900, currentFontWeight + delta));
      updateFontWeight(nextWeight);
      localStorage.setItem('kimo-lyrics-font-weight', nextWeight);
    };
    bindPopoverWheel(fontWeightSlider, handleFontWeightWheel);
  }
  updateFontWeight(currentFontWeight);

  const alignBtn = document.getElementById('btn-align-toggle');
  const scrollEl = document.getElementById('lyrics-scroll');
  let currentAlign = localStorage.getItem('kimo-lyrics-align') || 'center';

  const applyAlign = (align) => {
    if (!scrollEl || !alignBtn) return;
    if (align === 'left') {
      scrollEl.classList.remove('align-center');
      scrollEl.classList.add('align-left');
      alignBtn.classList.add('left-active');
    } else {
      scrollEl.classList.remove('align-left');
      scrollEl.classList.add('align-center');
      alignBtn.classList.remove('left-active');
    }
    resetLyricsAlignment();
  };

  if (alignBtn) {
    applyAlign(currentAlign);
    alignBtn.addEventListener('click', () => {
      currentAlign = currentAlign === 'center' ? 'left' : 'center';
      localStorage.setItem('kimo-lyrics-align', currentAlign);
      applyAlign(currentAlign);
    });
  }

  let currentTimeOffset = parseFloat(localStorage.getItem('kimo-lyrics-time-offset')) || 0.0;
  const lyricOffsetSlider = document.getElementById('slider-lyric-offset');
  const lyricOffsetValue = document.getElementById('lyric-offset-value');

  const updateOffsetLabel = (val) => {
    if (!lyricOffsetValue) return;
    if (val === 0) {
      lyricOffsetValue.innerText = '无延迟 (0.0s)';
    } else if (val > 0) {
      lyricOffsetValue.innerText = `延迟 +${val.toFixed(1)}s`;
    } else {
      lyricOffsetValue.innerText = `提前 ${val.toFixed(1)}s`;
    }
    updateSliderFill(lyricOffsetSlider);
  };

  if (lyricOffsetSlider) {
    lyricOffsetSlider.value = currentTimeOffset;
    updateOffsetLabel(currentTimeOffset);
    lyricOffsetSlider.addEventListener('input', (e) => {
      updateOffsetLabel(parseFloat(e.target.value));
    });
    lyricOffsetSlider.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      currentTimeOffset = val;
      updateLyricsPreference('timeOffset', val);
      updateOffsetLabel(val);
      syncLyricsToCurrentTime();
    });

    const handleOffsetWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const min = parseFloat(lyricOffsetSlider.min) || -5.0;
      const max = parseFloat(lyricOffsetSlider.max) || 5.0;
      const nextVal = Math.max(min, Math.min(max, currentTimeOffset + delta));
      currentTimeOffset = nextVal;
      lyricOffsetSlider.value = nextVal;
      updateOffsetLabel(nextVal);
      updateLyricsPreference('timeOffset', nextVal);
      syncLyricsToCurrentTime();
    };
    bindPopoverWheel(lyricOffsetSlider, handleOffsetWheel);
  }

  let currentScrollAlign = parseFloat(localStorage.getItem('kimo-lyrics-scroll-align')) || 0.5;
  const lyricAlignSlider = document.getElementById('slider-lyric-align');
  const lyricAlignValue = document.getElementById('lyric-align-value');

  const updateAlignLabel = (val) => {
    if (!lyricAlignValue) return;
    const percentage = Math.round(val * 100);
    if (val === 0.35) {
      lyricAlignValue.innerText = `默认居中偏上 (${percentage}%)`;
    } else if (val < 0.35) {
      lyricAlignValue.innerText = `偏上 (${percentage}%)`;
    } else {
      lyricAlignValue.innerText = `偏下 (${percentage}%)`;
    }
    updateSliderFill(lyricAlignSlider);
  };

  if (lyricAlignSlider) {
    lyricAlignSlider.value = currentScrollAlign;
    updateAlignLabel(currentScrollAlign);

    const applyScrollAlign = (val) => {
      currentScrollAlign = val;
      updateAlignLabel(val);
      updateLyricsPreference('scrollAlign', val);
      if (player.lyrics) player.lyrics.realign();
    };

    lyricAlignSlider.addEventListener('input', (e) => applyScrollAlign(parseFloat(e.target.value)));
    lyricAlignSlider.addEventListener('change', (e) => applyScrollAlign(parseFloat(e.target.value)));

    const handleAlignWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const min = parseFloat(lyricAlignSlider.min) || 0.1;
      const max = parseFloat(lyricAlignSlider.max) || 0.8;
      const nextVal = Math.max(min, Math.min(max, currentScrollAlign + delta));
      lyricAlignSlider.value = nextVal;
      applyScrollAlign(nextVal);
    };
    bindPopoverWheel(lyricAlignSlider, handleAlignWheel);
  }

  const staggerToggleBtn = document.getElementById('btn-stagger-toggle');
  if (staggerToggleBtn) {
    staggerToggleBtn.addEventListener('click', () => {
      if (player.lyrics) {
        player.lyrics.toggleStaggerMode();
        syncLyricsToCurrentTime();
      }
    });
  }

  const compatibilityButton = document.getElementById('btn-lyrics-compatibility');
  const compatibilityValue = document.getElementById('lyric-compatibility-value');
  const compatibilityOptions = document.querySelectorAll('.lyrics-compatibility-option');
  const compatibilityLabels = { auto: '自动', char: '强制逐字', line: '强制逐行' };
  const validCompatibilityModes = Object.keys(compatibilityLabels);

  const syncCompatibilityUI = (mode = localStorage.getItem('kimo-lyrics-compatibility-mode')) => {
    const activeMode = validCompatibilityModes.includes(mode) ? mode : 'auto';
    compatibilityOptions.forEach((option) => {
      option.classList.toggle('is-active', option.dataset.value === activeMode);
      option.setAttribute('aria-pressed', option.dataset.value === activeMode ? 'true' : 'false');
    });
    if (compatibilityValue) compatibilityValue.textContent = `兼容: ${compatibilityLabels[activeMode]}`;
    if (compatibilityButton) compatibilityButton.title = `歌词时间兼容模式：${compatibilityLabels[activeMode]}`;
  };

  const applyCompatibilityMode = (mode) => {
    if (!validCompatibilityModes.includes(mode)) return;
    localStorage.setItem('kimo-lyrics-compatibility-mode', mode);
    if (player.lyrics) {
      player.lyrics.lyricsCompatibilityMode = mode;
      player.lyrics.render();
      if (player.lyrics.isVisible) {
        player.lyrics.realign();
        syncLyricsToCurrentTime();
      }
    }
    syncCompatibilityUI(mode);
    document.dispatchEvent(new CustomEvent('lyrics-compatibility-changed', { detail: { mode } }));
  };

  compatibilityOptions.forEach((option) => {
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      applyCompatibilityMode(option.dataset.value);
    });
  });
  document.addEventListener('lyrics-compatibility-changed', (event) => syncCompatibilityUI(event.detail?.mode));
  syncCompatibilityUI();

  document.getElementById('lyrics-back-btn')?.addEventListener('click', () => {
    player.lyrics.hide();
  });

  const triggerLyricsShow = () => {
    if (player.currentIndex >= 0) player.lyrics.show();
  };
  document.getElementById('player-meta-trigger')?.addEventListener('click', triggerLyricsShow);
  document.getElementById('player-bar-lyric-trigger')?.addEventListener('click', triggerLyricsShow);
}
import { updateLyricsPreference } from '../lyrics/preferences.js';
