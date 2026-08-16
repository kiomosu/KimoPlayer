export function alignLyricRows(domLine, words, { force = false, rowThresholdPx = 15 } = {}) {
  let needRealign = !domLine.rowsData
    || domLine.dataset.bgAligned !== 'true'
    || domLine.rowsData.some(row => row.width <= 0);

  if (force) {
    needRealign = true;
  }

  if (!needRealign || words.length === 0) {
    return false;
  }

  const wordList = Array.from(words);
  const domLineRect = domLine.getBoundingClientRect();
  const wordMetrics = wordList.map((word, index) => {
    const rect = word.getBoundingClientRect();
    const suffixNode = word.querySelector('.lyrics-ruby-suffix');
    return {
      word,
      index,
      relativeTop: rect.top - domLineRect.top,
      offsetLeft: word.offsetLeft,
      offsetWidth: word.offsetWidth,
      suffixNode,
      suffixOffsetLeft: suffixNode ? suffixNode.offsetLeft : 0,
    };
  });

  domLine._prevFirstRelativeTop = wordMetrics[0].relativeTop;
  domLine._prevLastRelativeTop = wordMetrics[wordMetrics.length - 1].relativeTop;

  const rowGroups = [];
  wordMetrics.forEach(metric => {
    const foundGroup = rowGroups.find(group => Math.abs(group[0].relativeTop - metric.relativeTop) < rowThresholdPx);

    if (foundGroup) {
      foundGroup.push(metric);
    } else {
      rowGroups.push([metric]);
    }
  });

  rowGroups.sort((a, b) => a[0].relativeTop - b[0].relativeTop);

  const rowsData = [];
  const styleUpdates = [];
  let allValid = true;

  rowGroups.forEach((rowMetrics, rowIndex) => {
    rowMetrics.sort((a, b) => a.offsetLeft - b.offsetLeft);

    const firstMetric = rowMetrics[0];
    const lastMetric = rowMetrics[rowMetrics.length - 1];
    const rowLeft = firstMetric.offsetLeft;
    const rowRight = lastMetric.offsetLeft + lastMetric.offsetWidth;
    const rowWidth = rowRight - rowLeft;

    if (rowWidth <= 0) {
      allValid = false;
    }

    const widthToUse = rowWidth || 300;

    rowMetrics.forEach(metric => {
      const baseOffset = metric.offsetLeft - rowLeft;
      styleUpdates.push({
        metric,
        rowIndex,
        baseOffset,
        widthToUse,
      });
    });

    rowsData.push({
      rowIndex,
      left: rowLeft,
      width: widthToUse,
      words: rowMetrics.map(metric => metric.word),
      // Keep the measured word geometry alongside the DOM words. The row
      // progress renderer/playhead uses this indexed data to advance the
      // fill without reading layout on every frame.
      wordData: rowMetrics.map(metric => ({
        word: metric.word,
        index: metric.index,
        offsetLeft: metric.offsetLeft - rowLeft,
        offsetWidth: metric.offsetWidth,
        offsetRight: metric.offsetLeft - rowLeft + metric.offsetWidth,
      })),
      startIdx: firstMetric.index,
      endIdx: lastMetric.index,
    });
  });

  styleUpdates.forEach(({ metric, rowIndex, baseOffset, widthToUse }) => {
    const { word, suffixNode, suffixOffsetLeft } = metric;
    word.style.setProperty('--line-width', `${widthToUse}px`);
    word.style.setProperty('--char-offset', `${baseOffset}px`);

    if (suffixNode) {
      suffixNode.style.setProperty('--char-offset', `${baseOffset + suffixOffsetLeft}px`);
    }

    word.style.setProperty('--glow-left-pct', ((70 / widthToUse) * 100).toFixed(3));
    word.style.setProperty('--glow-right-pct', ((50 / widthToUse) * 100).toFixed(3));
    word.style.setProperty('--glow-mid-pct', ((20 / widthToUse) * 100).toFixed(3));
    word.dataset.rowIndex = rowIndex;
  });

  domLine.rowsData = rowsData;

  if (allValid && rowsData.length > 0) {
    domLine.dataset.bgAligned = 'true';
  }

  return true;
}
