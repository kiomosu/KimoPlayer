const STORAGE_KEY = 'kimo-keyboard-shortcuts';

export const SHORTCUT_DEFINITIONS = [
  { id: 'toggle-playback', label: '播放 / 暂停', description: '控制当前歌曲播放状态', defaultBinding: 'Space' },
  { id: 'previous-track', label: '上一首', description: '切换到上一首歌曲', defaultBinding: 'Ctrl+ArrowLeft' },
  { id: 'next-track', label: '下一首', description: '切换到下一首歌曲', defaultBinding: 'Ctrl+ArrowRight' },
  { id: 'seek-backward', label: '后退 5 秒', description: '在当前歌曲中向后跳转 5 秒', defaultBinding: 'ArrowLeft' },
  { id: 'seek-forward', label: '前进 5 秒', description: '在当前歌曲中向前跳转 5 秒', defaultBinding: 'ArrowRight' },
  { id: 'volume-down', label: '降低音量', description: '每次降低 5% 音量', defaultBinding: 'ArrowDown' },
  { id: 'volume-up', label: '提高音量', description: '每次提高 5% 音量', defaultBinding: 'ArrowUp' },
  { id: 'toggle-mute', label: '静音 / 恢复声音', description: '切换静音状态', defaultBinding: 'KeyM' },
  { id: 'open-search', label: '打开搜索', description: '切换到全局搜索并聚焦输入框', defaultBinding: 'Ctrl+KeyF' },
  { id: 'show-lyrics', label: '打开歌词页', description: '显示当前歌曲歌词页面', defaultBinding: 'KeyL' },
];

const definitionById = new Map(SHORTCUT_DEFINITIONS.map(item => [item.id, item]));

export function getDefaultShortcuts() {
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map(item => [item.id, item.defaultBinding]));
}

export function getShortcutBindings() {
  const defaults = getDefaultShortcuts();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    return Object.fromEntries(SHORTCUT_DEFINITIONS.map(item => [
      item.id,
      typeof saved[item.id] === 'string' ? saved[item.id] : defaults[item.id],
    ]));
  } catch {
    return defaults;
  }
}

function persist(bindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

function normalizeBindingParts(parts) {
  const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter(item => parts.includes(item));
  const key = parts.find(item => !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(item));
  return key ? [...modifiers, key].join('+') : '';
}

export function bindingFromKeyboardEvent(event) {
  if (!event || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  const key = event.code === 'Space' ? 'Space' : event.code;
  if (!key) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return normalizeBindingParts(parts);
}

export function formatShortcutBinding(binding) {
  if (!binding) return '未设置';
  const labels = {
    Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: '⌘',
    Space: '空格', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Escape: 'Esc', Backspace: '退格', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab',
  };
  return binding.split('+').map(part => {
    if (labels[part]) return labels[part];
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit\d$/.test(part)) return part.slice(5);
    return part.replace(/^Numpad/, '数字键盘 ');
  }).join(' + ');
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function bindingMatchesEvent(binding, event) {
  return binding && binding === bindingFromKeyboardEvent(event);
}

export function createKeyboardShortcutManager({ player, switchTab, showToast }) {
  let bindings = getShortcutBindings();
  let mutedVolume = null;

  const updateVolume = delta => {
    const audio = player?.audio;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, audio.volume + delta));
    localStorage.setItem('kimo-player-volume', String(audio.volume));
    window.dispatchEvent(new CustomEvent('kimo-volume-changed'));
  };

  const actions = {
    'toggle-playback': () => player?.toggle?.(),
    'previous-track': () => player?.prev?.(),
    'next-track': () => player?.next?.(),
    'seek-backward': () => {
      if (!player?.audio) return;
      player.audio.currentTime = Math.max(0, player.audio.currentTime - 5);
    },
    'seek-forward': () => {
      if (!player?.audio) return;
      const duration = Number.isFinite(player.audio.duration) ? player.audio.duration : Infinity;
      player.audio.currentTime = Math.min(duration, player.audio.currentTime + 5);
    },
    'volume-down': () => updateVolume(-0.05),
    'volume-up': () => updateVolume(0.05),
    'toggle-mute': () => {
      const audio = player?.audio;
      if (!audio) return;
      if (audio.volume > 0) {
        mutedVolume = audio.volume;
        audio.volume = 0;
      } else {
        audio.volume = mutedVolume || 0.8;
      }
      localStorage.setItem('kimo-player-volume', String(audio.volume));
      window.dispatchEvent(new CustomEvent('kimo-volume-changed'));
    },
    'open-search': () => {
      switchTab?.('search');
      setTimeout(() => document.getElementById('global-search-input')?.focus(), 0);
    },
    'show-lyrics': () => player?.lyrics?.show?.(),
  };

  const onKeyDown = event => {
    if (event.defaultPrevented || event.isComposing || document.body.classList.contains('shortcut-capture-active') || isEditableTarget(event.target)) return;
    const matched = SHORTCUT_DEFINITIONS.find(item => bindingMatchesEvent(bindings[item.id], event));
    if (!matched) return;
    event.preventDefault();
    actions[matched.id]?.();
  };

  window.addEventListener('keydown', onKeyDown);

  return {
    getBindings: () => ({ ...bindings }),
    setBinding(actionId, binding) {
      if (!definitionById.has(actionId)) return { ok: false, reason: '未知操作' };
      const normalized = String(binding || '');
      const conflict = normalized && SHORTCUT_DEFINITIONS.find(item => item.id !== actionId && bindings[item.id] === normalized);
      if (conflict) return { ok: false, reason: `已用于“${conflict.label}”` };
      bindings = { ...bindings, [actionId]: normalized };
      persist(bindings);
      return { ok: true };
    },
    resetBinding(actionId) {
      if (!definitionById.has(actionId)) return;
      const defaults = getDefaultShortcuts();
      bindings = { ...bindings, [actionId]: defaults[actionId] };
      persist(bindings);
    },
    resetAll() {
      bindings = getDefaultShortcuts();
      persist(bindings);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
