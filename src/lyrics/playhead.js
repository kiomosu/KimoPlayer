/**
 * 卡拉OK播放头计算 —— 基于逐字独立时间轴（AMLL 架构）。
 *
 * 核心：
 * 1. 每个字有独立的 [startTime, endTime] 时间窗，根据 currentTime 直接计算其状态
 *    （future / active / past）及字内填充百分比，消除通过 charC 索引投影的误差。
 * 2. 播放头物理位置基于 row-layout.js 预存的子像素精度位置，
 *    不再每帧从 DOM 读取整数偏移，消除取整误差累积。
 * 3. playheadX 返回"歌唱位置"（CSS中 unfilled 起始点），
 *    过渡带向左侧延伸 transitionWidthPx：
 *      filled  at (line-percent - transition-width)
 *      unfilled at line-percent
 * 4. active阶段完全线性（p 0→100%），past阶段基于时间平滑推出（p 100→112%），
 *    不再有非线性加速或瞬间跳变。
 * 5. 保留 charC 兼容接口供 mini-bar / 桌面歌词 / 词效模块使用。
 */

const WORD_GAP_THRESHOLD = 0.001;
const LEADIN_TIME = 0.3;
const OVERRUN_TIME = 0.3;
/** 字唱完后，过渡带完全推出所需的时间（秒） */
const POST_WORD_OVERSHOOT_TIME = 0.12;
/** 推出完成后保持的p值（%），确保过渡带完全出界 */
const POST_OVERSHOOT_PCT = 112;

function getWordEnd(word) {
  if (!word) return 0;
  if (word.endTime != null && word.endTime > word.time) {
    return word.endTime;
  }
  if (word.duration != null && word.duration > 0) {
    return word.time + word.duration;
  }
  return word.time + 0.3;
}

/**
 * 计算所有字的填充状态（逐字独立时间轴）。
 * past状态的字包含 postFill 字段（0→1，过渡带推出进度）。
 */
export function calculateWordFillStates(charWords, currentTime) {
  // Lyrics without word-level timing are valid (plain TTML/LRC and some
  // interlude rows). Keep the sync loop alive instead of dereferencing an
  // absent character timeline.
  if (!Array.isArray(charWords)) charWords = [];
  const totalChars = charWords.length;
  const states = new Array(totalChars);
  let activeIdx = -1;
  let activeFillPct = 0;
  let lastCompletedIdx = -1;

  for (let i = 0; i < totalChars; i++) {
    const word = charWords[i];
    if (!word) {
      states[i] = { state: 'future', fillPct: 0, postFill: 0 };
      continue;
    }
    const start = word.time;
    const end = getWordEnd(word);

    if (currentTime < start) {
      states[i] = { state: 'future', fillPct: 0, postFill: 0 };
    } else if (currentTime >= end) {
      const overshootT = Math.min(1, Math.max(0, (currentTime - end) / POST_WORD_OVERSHOOT_TIME));
      states[i] = { state: 'past', fillPct: 1, postFill: overshootT };
      lastCompletedIdx = i;
    } else {
      const dur = end - start;
      const fill = dur > 0 ? Math.max(0, Math.min(1, (currentTime - start) / dur)) : 1;
      states[i] = { state: 'active', fillPct: fill, postFill: 0 };
      activeIdx = i;
      activeFillPct = fill;
    }
  }

  return { states, activeIdx, activeFillPct, lastCompletedIdx, totalChars };
}

/**
 * 基于预存子像素位置，计算指定物理行的播放头 X 坐标（歌唱位置 / unfilled 起始点）。
 *
 * 返回值是歌唱位置（unfilled起始点），相对于行左边缘。
 * 过渡带在其左侧 transitionWidthPx 宽度。
 */
export function calculatePlayheadXForRow({
  rowsData,
  rowIndex,
  wordStates,
  activeIdx,
  activeFillPct,
  lastCompletedIdx,
  charWords,
  currentTime,
  transitionWidthPx,
}) {
  const safeRowsData = Array.isArray(rowsData) ? rowsData : [];
  const safeCharWords = Array.isArray(charWords) ? charWords : [];
  const row = safeRowsData[rowIndex];
  if (!row) return 0;

  const wordData = Array.isArray(row.wordData) ? row.wordData : [];
  const rowWidth = row.width;
  const rowStartIdx = row.startIdx;
  const rowEndIdx = row.endIdx;
  const transW = transitionWidthPx;

  // 行还没开始
  if (lastCompletedIdx < rowStartIdx && activeIdx < rowStartIdx) {
    if (activeIdx === -1 && lastCompletedIdx === -1) {
      const firstWord = safeCharWords[rowStartIdx];
      if (firstWord) {
        const timeToStart = firstWord.time - currentTime;
        if (timeToStart < LEADIN_TIME && timeToStart > 0) {
          const progress = 1 - timeToStart / LEADIN_TIME;
          return -transW * (1 - progress);
        }
      }
    }
    return -transW - 20;
  }

  // 行已完全唱完
  if (lastCompletedIdx >= rowEndIdx) {
    const lastWord = safeCharWords[rowEndIdx];
    if (lastWord) {
      const overshootTime = currentTime - getWordEnd(lastWord);
      if (overshootTime < OVERRUN_TIME && overshootTime >= 0) {
        const wd = wordData[wordData.length - 1];
        const overshoot = (overshootTime / OVERRUN_TIME) * (wd?.offsetWidth ?? 40) * 0.3;
        return rowWidth + transW + overshoot;
      }
    }
    return rowWidth + transW + 12;
  }

  // 正在唱的字在本行内：歌唱位置 = 字左 + 字宽 × fillPct（完全线性）
  if (activeIdx >= rowStartIdx && activeIdx <= rowEndIdx) {
    const wd = wordData.find(w => w.index === activeIdx);
    if (wd) {
      return wd.offsetLeft + wd.offsetWidth * activeFillPct;
    }
  }

  // 间隙中：上一个字已past，下一个字还未开始（在本行内）
  if (lastCompletedIdx >= rowStartIdx && lastCompletedIdx < rowEndIdx) {
    const nextIdx = lastCompletedIdx + 1;
    const nextWord = safeCharWords[nextIdx];
    const prevWord = safeCharWords[lastCompletedIdx];
    if (nextWord && prevWord) {
      const nextOnRow = nextIdx <= rowEndIdx;
      if (nextOnRow) {
        const prevWd = wordData.find(w => w.index === lastCompletedIdx);
        if (prevWd) {
          // 前字刚唱完时，playheadX=prevWd.offsetRight，然后继续平滑推出过渡带
          // （让前字末尾的8%过渡色被推过）
          const wordEnd = getWordEnd(prevWord);
          const overshootT = Math.min(1, Math.max(0, (currentTime - wordEnd) / POST_WORD_OVERSHOOT_TIME));
          return prevWd.offsetRight + transW * overshootT;
        }
      }
    }
  }

  if (lastCompletedIdx >= rowStartIdx) {
    const lastWd = wordData[wordData.length - 1];
    if (lastWd) {
      return lastWd.offsetRight + transW;
    }
  }

  return -transW;
}

/**
 * 将播放头像素位置转为行内百分比（用于 CSS --line-percent）。
 */
export function playheadXToPercent(playheadX, rowWidth) {
  if (rowWidth <= 0) return 0;
  return Math.max(-10, Math.min(125, (playheadX / rowWidth) * 100));
}

/**
 * 获取单个字的渲染百分比（用于 classic 逐字独立渐变模式）。
 * 返回歌唱位置百分比 p：
 *   future: 0
 *   active: fillPct * 100（线性 0→100%）
 *   past(overshooting): 100 + postFill * 12（100→112% 平滑推出）
 *   past(done): 112
 */
export function getWordRenderPercent(wordState) {
  if (!wordState || wordState.state === 'future') return 0;
  if (wordState.state === 'active') return wordState.fillPct * 100;
  // past: postFill从0到1，p从100%平滑到112%
  return 100 + wordState.postFill * (POST_OVERSHOOT_PCT - 100);
}

/**
 * 兼容旧接口：计算逐字字符进度（用于 mini-bar / 桌面歌词 / 词效模块）。
 */
export function calculateKaraokePlayheadState(charWords, currentTime) {
  if (!Array.isArray(charWords)) charWords = [];
  const { states, activeIdx, activeFillPct, lastCompletedIdx, totalChars } =
    calculateWordFillStates(charWords, currentTime);

  let charC;
  let inGap = false;
  let gapPrevIdx = -1;
  let currentGapT = 0;

  if (activeIdx >= 0) {
    charC = activeIdx + activeFillPct;
  } else if (lastCompletedIdx === -1) {
    const firstStart = charWords[0]?.time ?? 0;
    charC = 0 - Math.max(0, (firstStart - currentTime) / LEADIN_TIME);
  } else if (lastCompletedIdx === totalChars - 1) {
    const lastWord = charWords[lastCompletedIdx];
    const overshootT = Math.min(1, Math.max(0, (currentTime - getWordEnd(lastWord)) / POST_WORD_OVERSHOOT_TIME));
    charC = (lastCompletedIdx + 1) + overshootT * 0.12;
  } else {
    const prevWord = charWords[lastCompletedIdx];
    const nextWord = charWords[lastCompletedIdx + 1];
    const gapStart = getWordEnd(prevWord);
    const gapEnd = nextWord?.time ?? gapStart;
    const gapDur = gapEnd - gapStart;
    inGap = true;
    gapPrevIdx = lastCompletedIdx;
    if (gapDur > 0.001) {
      currentGapT = Math.max(0, Math.min(1, (currentTime - gapStart) / gapDur));
    } else {
      currentGapT = 1;
    }
    charC = lastCompletedIdx + 1;
  }

  return { charC, totalChars, inGap, gapPrevIdx, currentGapT, states, activeIdx, activeFillPct, lastCompletedIdx };
}

export function calculateSimpleCharProgress(charWords, currentTime) {
  return calculateKaraokePlayheadState(charWords, currentTime).charC;
}
