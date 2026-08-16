/**
 * 卡拉OK渐变填充渲染器
 *
 * 参考 AMLL 架构：
 * - bg-aligned 模式（整行共享渐变拼接）：基于逐字独立时间轴计算精确歌唱位置，
 *   使用预存子像素精度的字位置数据，不再每帧从 DOM 读取整数偏移。
 *   --line-percent 表示歌唱位置（unfilled 起始点），fill edge = line-percent - 8%。
 * - 降级模式（逐字独立渐变）：每个字基于自身时间窗独立计算填充百分比，
 *   --char-fill 表示字内歌唱位置，fill edge = char-fill - 8%。
 *
 * 坐标约定（与CSS渐变完全一致）：
 *   filled  at (p - transition-width)
 *   unfilled  at p
 * 其中 p = --line-percent 或 --char-fill，代表歌唱位置（unfilled起始点）。
 *
 * 渲染值完全线性，不做任何非线性映射：
 *   active阶段 p 从0%线性到100%（歌唱位置匀速扫过字宽），
 *   past阶段 p 从100%基于时间平滑插值到112%（过渡带自然推出），
 *   不再有"加速冲刺"或瞬间跳变。
 */
import {
  calculateWordFillStates,
  calculatePlayheadXForRow,
  playheadXToPercent,
  getWordRenderPercent,
  calculateKaraokePlayheadState,
} from './playhead.js';

// 与 lyrics-rendering.css 的 --transition-width 保持一致（渐变过渡带宽度）
const DEFAULT_TRANSITION_RATIO = 0.2;

function clearProgressWord(word) {
  word.classList.remove('word-singing', 'word-active');
  word.style.removeProperty('--line-percent');
  word.style.removeProperty('--line-width');
  word.style.removeProperty('--char-offset');
  word.style.removeProperty('--char-fill');
  word._lastPercent = null;
  word._lastFill = null;
}

function setWordLinePercent(word, percent) {
  const clamped = Math.max(-10, Math.min(130, percent));
  const rounded = clamped.toFixed(1);
  if (word._lastPercent !== rounded) {
    word._lastPercent = rounded;
    word.style.setProperty('--line-percent', `${rounded}%`);
  }
  if (clamped > 0.5) {
    word.classList.add('word-singing');
    word.classList.remove('word-active');
  } else {
    word.classList.remove('word-singing', 'word-active');
  }
}
function setWordCharFill(word, fillPercent) {
  const clamped = Math.max(0, Math.min(100, fillPercent));
  const rounded = clamped.toFixed(1);
  if (word._lastFill !== rounded) {
    word._lastFill = rounded;
    word.style.removeProperty('--line-percent');
    word.style.removeProperty('--line-width');
    word.style.removeProperty('--char-offset');
    word.style.setProperty('--char-fill', `${rounded}%`);

    let subSpans = word._subSpans;
    if (!subSpans) {
      subSpans = Array.from(word.querySelectorAll('span'));
      word._subSpans = subSpans;
    }
    for (let i = 0; i < subSpans.length; i++) {
      subSpans[i].style.removeProperty('--line-percent');
      subSpans[i].style.removeProperty('--line-width');
      subSpans[i].style.removeProperty('--char-offset');
      subSpans[i].style.setProperty('--char-fill', `${rounded}%`);
    }
  }

  if (clamped >= 99.5) {
    word.classList.add('word-active');
    word.classList.remove('word-singing');
  } else if (clamped <= 0.5) {
    word.classList.remove('word-singing', 'word-active');
  } else {
    word.classList.add('word-singing');
    word.classList.remove('word-active');
  }
}

/**
 * 整行渐变拼接模式（bg-aligned）。
 * 所有字共享统一 --line-percent（歌唱位置百分比），
 * 通过 background-size/background-position 拼接连续渐变。
 */
export function renderRowKaraokeProgress({
  rowsData,
  wordSpans,
  charWords,
  currentTime,
}) {
  const { states, activeIdx, activeFillPct, lastCompletedIdx } =
    calculateWordFillStates(charWords, currentTime);

  rowsData.forEach((row, rowIndex) => {
    const transitionWidthPx = row.width * DEFAULT_TRANSITION_RATIO;

    const playheadX = calculatePlayheadXForRow({
      rowsData,
      rowIndex,
      wordStates: states,
      activeIdx,
      activeFillPct,
      lastCompletedIdx,
      charWords,
      currentTime,
      transitionWidthPx,
    });

    const rowPercent = playheadXToPercent(playheadX, row.width);

    const rowStartIdx = row.startIdx;
    const rowEndIdx = row.endIdx;
    const isLeadIn = activeIdx === -1 && lastCompletedIdx === -1;
    const isRowPast = lastCompletedIdx >= rowEndIdx;
    const isRowPending = !isLeadIn && lastCompletedIdx < rowStartIdx && activeIdx < rowStartIdx;

    const wordData = Array.isArray(row.wordData) ? row.wordData : [];
    wordData.forEach(wd => {
      const wordEl = wd.word;

      if (isRowPending) {
        clearProgressWord(wordEl);
        return;
      }

      setWordLinePercent(wordEl, rowPercent);
    });
  });
}

/**
 * 桌面歌词 1:1 原装渲染引擎（完全同源 verbatim 代码）：
 * 直接复用 desktop-lyrics-window.js 中 updateKaraokeSpans 的完全相同代码，
 * 保证主界面与桌面歌词在任意时刻 100% 表现一致。
 */
export function renderClassicCharProgress({ wordSpans, charWords, currentTime }) {
  if (!wordSpans || wordSpans.length === 0 || !charWords || charWords.length === 0) return;

  const { charC, totalChars } = calculateKaraokePlayheadState(charWords, currentTime);

  for (let index = 0; index < wordSpans.length; index += 1) {
    const barSpan = wordSpans[index];
    if (!barSpan) continue;

    let fill;
    if (charC < 0) {
      fill = 0;
    } else if (charC >= totalChars) {
      fill = 100;
    } else {
      const intPart = Math.floor(charC);
      if (index < intPart) fill = 100;
      else if (index > intPart) fill = 0;
      else fill = (charC - intPart) * 100;
    }

    const clamped = Math.max(0, Math.min(100, fill));
    const charFillVal = `${clamped.toFixed(1)}%`;
    // Classic karaoke must own the progress variables completely. A hot
    // update from the experimental row renderer can leave --line-percent
    // inline, which has higher priority in CSS and freezes the visible fill
    // even while --char-fill keeps changing.
    barSpan.style.removeProperty('--line-percent');
    barSpan.style.removeProperty('--line-width');
    barSpan.style.removeProperty('--char-offset');
    // ⭐ 值守卫：已填满/未开始的字 fill 恒定，跳过写入（每帧 60-80% 的字可省）
    if (barSpan._lastCharFill !== charFillVal) {
      barSpan._lastCharFill = charFillVal;
      barSpan.style.setProperty('--char-fill', charFillVal);
      let subSpans = barSpan._barSubSpans;
      if (!subSpans) {
        subSpans = Array.from(barSpan.querySelectorAll('span'));
        barSpan._barSubSpans = subSpans;
      }
      for (let subIndex = 0; subIndex < subSpans.length; subIndex += 1) {
        subSpans[subIndex].style.removeProperty('--line-percent');
        subSpans[subIndex].style.removeProperty('--line-width');
        subSpans[subIndex].style.removeProperty('--char-offset');
        subSpans[subIndex].style.setProperty('--char-fill', charFillVal);
      }
    }

    if (clamped >= 99) {
      barSpan.classList.add('word-singing');
      barSpan.classList.remove('word-active');
    } else if (clamped <= 1) {
      if (barSpan.classList.contains('word-active') || barSpan.classList.contains('word-singing')) {
        barSpan.classList.remove('word-active', 'word-singing');
      }
    } else if (!barSpan.classList.contains('word-singing')) {
      barSpan.classList.add('word-singing');
      barSpan.classList.remove('word-active');
    }
  }
}
