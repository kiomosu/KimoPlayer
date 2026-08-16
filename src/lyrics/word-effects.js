// Mirrors NativeAmllLyricsView.kt exactly: the lift is driven by each
// character's own timing window, rather than its distance from a synthetic
// playhead index.
const CHARACTER_MIN_PRELIFT_S = 0.080;
const CHARACTER_MAX_PRELIFT_S = 0.320;
const CHARACTER_MIN_SETTLE_S = 0.048;
const CHARACTER_MAX_SETTLE_S = 0.180;
const CHARACTER_LIFT_EM = 0.12;
const CHARACTER_PREDICT_COUNT = 3;
const LIFT_WRITE_EPSILON = 0.005;
const GLOW_WRITE_EPSILON = 0.01;

export function collectLongGlowIndices(wordSpans) {
  const longIndices = [];
  wordSpans.forEach((span, index) => {
    if (span?.classList.contains('long-glow')) longIndices.push(index);
  });
  return longIndices;
}

function getWordEnd(word) {
  if (!word) return 0;
  if (Number.isFinite(word.end) && word.end > word.time) return word.end;
  if (Number.isFinite(word.duration) && word.duration > 0) return word.time + word.duration;
  return word.time + 0.3;
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function getFontSizePx(span) {
  if (Number.isFinite(span._androidLiftFontPx)) return span._androidLiftFontPx;
  const value = Number.parseFloat(getComputedStyle(span).fontSize);
  span._androidLiftFontPx = Number.isFinite(value) && value > 0 ? value : 22;
  return span._androidLiftFontPx;
}

// Equivalent to NativeAmllLyricsView.characterLiftPx().
export function calculateAndroidCharacterLiftPx(word, currentTime, fontSizePx) {
  const duration = Math.max(0.001, getWordEnd(word) - word.time);
  const preLift = Math.max(CHARACTER_MIN_PRELIFT_S, Math.min(CHARACTER_MAX_PRELIFT_S, duration * 2.5));
  const settle = Math.max(CHARACTER_MIN_SETTLE_S, Math.min(CHARACTER_MAX_SETTLE_S, duration * 1.5));
  const liftStart = word.time - preLift;
  if (currentTime <= liftStart) return 0;
  const liftEnd = getWordEnd(word) + settle;
  const progress = (currentTime - liftStart) / Math.max(0.001, liftEnd - liftStart);
  return fontSizePx * CHARACTER_LIFT_EM * smoothstep(progress);
}

function applyLift(span, liftPx) {
  const previous = Number.parseFloat(span.dataset.liftVal || '0');
  if (Math.abs(liftPx - previous) <= LIFT_WRITE_EPSILON) return;
  span.style.transition = 'none';
  span.style.transform = `translateY(${-liftPx.toFixed(2)}px) translateZ(0)`;
  span.dataset.liftVal = liftPx.toFixed(3);
}

function calculateGlow(index, charC, longIndices) {
  let glow = 0;
  longIndices.forEach(longIndex => {
    const distance = longIndex - charC;
    const power = distance > 0
      ? Math.max(0, 1 - distance / 1.2)
      : Math.max(0, 1 - Math.abs(distance) / 1.8);
    const spreadDistance = Math.abs(index - longIndex);
    const spread = spreadDistance === 0 ? 1 : Math.max(0, 1 - spreadDistance / 1.2) * 0.55;
    glow = Math.max(glow, power * spread);
  });
  return glow;
}

function applyGlow(span, glow) {
  const previous = Number.parseFloat(span.dataset.glowVal || '-999');
  if (Math.abs(glow - previous) <= GLOW_WRITE_EPSILON && glow !== 0 && glow !== 1) return;
  span.style.setProperty('--singing-glow-intensity', glow.toFixed(3));
  span.dataset.glowVal = glow.toFixed(3);
  span.classList.toggle('singing-glow', glow > 0.01);
}

export function renderWordMotionEffects({
  wordSpans,
  charWords,
  charC,
  currentTime,
  longIndices = collectLongGlowIndices(wordSpans),
}) {
  // NativeAmllLyricsView only draws the current glyph and the next three
  // predicted glyphs. Past glyphs remain in that range naturally; future
  // glyphs outside it must stay on the baseline even when their time window
  // happens to overlap a long pre-lift interval.
  const currentIndex = charWords.findIndex(character => currentTime < getWordEnd(character));
  const lastAnimatedIndex = currentIndex < 0
    ? charWords.length - 1
    : Math.min(charWords.length - 1, currentIndex + CHARACTER_PREDICT_COUNT);

  wordSpans.forEach((span, index) => {
    const character = charWords[index];
    if (!character) return;
    const liftPx = index <= lastAnimatedIndex
      ? calculateAndroidCharacterLiftPx(character, currentTime, getFontSizePx(span))
      : 0;
    applyLift(span, liftPx);
    applyGlow(span, calculateGlow(index, charC, longIndices));
  });
}
