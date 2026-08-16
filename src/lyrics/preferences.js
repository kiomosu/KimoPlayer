const defaults = {
  timeOffset: 0,
  scrollAlign: 0.5,
  rowFollowEnabled: true,
  blurEnabled: true,
  filterInfoEnabled: false,
  rubyPosition: 'above', // 'above' | 'below'
};

let cachedPreferences = null;

function readNumber(key, fallback) {
  const value = Number.parseFloat(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function loadPreferences() {
  return {
    timeOffset: readNumber('kimo-lyrics-time-offset', defaults.timeOffset),
    scrollAlign: readNumber('kimo-lyrics-scroll-align', defaults.scrollAlign),
    rowFollowEnabled: localStorage.getItem('kimo-lyrics-row-follow-enabled') !== 'false',
    blurEnabled: localStorage.getItem('kimo-lyrics-blur-enabled') !== 'false',
    filterInfoEnabled: localStorage.getItem('kimo-lyrics-filter-info-enabled') === 'true',
    rubyPosition: localStorage.getItem('kimo-lyrics-ruby-position') || defaults.rubyPosition,
  };
}

export function getLyricsPreferences() {
  if (!cachedPreferences) cachedPreferences = loadPreferences();
  return cachedPreferences;
}

export function updateLyricsPreference(name, value) {
  const preferences = getLyricsPreferences();
  preferences[name] = value;

  const storageKeys = {
    timeOffset: 'kimo-lyrics-time-offset',
    scrollAlign: 'kimo-lyrics-scroll-align',
    rowFollowEnabled: 'kimo-lyrics-row-follow-enabled',
    blurEnabled: 'kimo-lyrics-blur-enabled',
    filterInfoEnabled: 'kimo-lyrics-filter-info-enabled',
    rubyPosition: 'kimo-lyrics-ruby-position',
  };
  const storageKey = storageKeys[name];
  if (storageKey) localStorage.setItem(storageKey, String(value));
}

export function refreshLyricsPreferences() {
  cachedPreferences = loadPreferences();
  return cachedPreferences;
}
