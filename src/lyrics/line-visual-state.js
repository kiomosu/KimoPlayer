function getWordSpans(lineEl) {
  if (!lineEl._wordSpans) {
    lineEl._wordSpans = lineEl.querySelectorAll('.lyrics-word');
  }

  return lineEl._wordSpans;
}

function resetFutureWord(word) {
  word.style.setProperty('--char-fill', '-10%');
  word.dataset.fillVal = '-10.0';
  word.classList.remove('word-active', 'word-singing');
  word.style.transition = '';
  word.style.transform = 'translateY(0px) translateZ(0)';
  word.dataset.liftVal = '0.000';
}

function completePastWord(word) {
  word.style.setProperty('--char-fill', '112%');
  word.dataset.fillVal = '112.0';
  word.classList.add('word-active');
  word.classList.remove('word-singing');
  word.style.transition = 'none';

  const fontSize = Number.parseFloat(getComputedStyle(word).fontSize);
  const finalLift = (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 22) * 0.12;

  word.style.transform = `translateY(${-finalLift.toFixed(2)}px) translateZ(0)`;
  word.dataset.liftVal = finalLift.toFixed(3);
}

export function updateInactiveLineFixedState({
  lineEl,
  lineIndex,
  activeIndices,
  viewActiveIndices,
  linesToProcess,
  currentTime,
  minActiveIndex,
  scrollIndex,
  lines,
}) {
  const lineEndWarmup = (lines[lineIndex]?.endTime || 0) + 0.4;

  if (!activeIndices.includes(lineIndex)
    && lineIndex !== scrollIndex
    && !linesToProcess.has(lineIndex)
    && currentTime > lineEndWarmup) {
    const targetState = 'past';
    if (lineEl.dataset.fixedState === targetState) {
      return;
    }

    const words = getWordSpans(lineEl);
    words.forEach(completePastWord);

    lineEl.dataset.fixedState = targetState;
    return;
  }

  const warmupEnd = (lines[lineIndex]?.endTime || 0) + 0.4;
  const inWarmup = currentTime <= warmupEnd && currentTime > (lines[lineIndex]?.time || 0);

  if (lineEl.dataset.fixedState && !inWarmup) {
    delete lineEl.dataset.fixedState;
  }

  if (!activeIndices.includes(lineIndex)
    && !linesToProcess.has(lineIndex)
    && lineIndex !== scrollIndex
    && !inWarmup
    && lineIndex >= minActiveIndex) {
    const words = getWordSpans(lineEl);
    words.forEach(resetFutureWord);
  }
}
