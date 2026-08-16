import {
  aggregateLatinWords,
  splitLatinWordsToChars,
} from './animation-units.js';
import { splitKanjiUnits } from './ruby-layout.js';

function createRubyContainer({ rubyText, mainText }) {
  const rubyContainer = document.createElement('span');
  rubyContainer.className = 'lyrics-ruby-container';

  const rtText = document.createElement('span');
  rtText.className = 'lyrics-rt-text';
  rtText.textContent = rubyText || '';
  rubyContainer.appendChild(rtText);

  const charText = document.createElement('span');
  charText.className = 'lyrics-char-text';
  charText.textContent = mainText;
  rubyContainer.appendChild(charText);

  if (rubyText) {
    rubyContainer.dataset.rubyVal = rubyText;
  }

  return rubyContainer;
}

function appendRubySuffix(span, suffixText) {
  if (!suffixText) return;

  const suffixSpan = document.createElement('span');
  suffixSpan.className = 'lyrics-ruby-suffix';
  suffixSpan.textContent = suffixText;
  span.appendChild(suffixSpan);
}

function appendSplitKanjiRubyWords({ mainDiv, charWords, coreText, ruby, time, duration }) {
  const units = splitKanjiUnits(coreText, ruby);

  if (units.length <= 1) {
    return false;
  }

  if (units[0].endIdx > 1) {
    const leading = coreText.substring(0, units[0].endIdx - 1);
    if (leading) {
      mainDiv.appendChild(document.createTextNode(leading));
    }
  }

  units.forEach((unit, index) => {
    const subSpan = document.createElement('span');
    subSpan.className = 'lyrics-word is-ruby-word';
    subSpan.appendChild(createRubyContainer({
      rubyText: unit.ruby || '',
      mainText: unit.kanji,
    }));
    appendRubySuffix(subSpan, unit.okurigana);
    mainDiv.appendChild(subSpan);

    charWords.push({
      time: time + duration * index / units.length,
      end: time + duration * (index + 1) / units.length,
      duration: duration / units.length,
      topoPos: charWords.length,
      text: unit.kanji,
    });
  });

  return true;
}

function appendRubyWord({ span, coreText, ruby }) {
  span.classList.add('is-ruby-word');

  const kanjiPart = coreText.match(/^[\u4e00-\u9faf]+/);
  if (kanjiPart) {
    const kanjiText = kanjiPart[0];
    const remainingText = coreText.substring(kanjiText.length);
    span.appendChild(createRubyContainer({ rubyText: ruby, mainText: kanjiText }));
    appendRubySuffix(span, remainingText);
  } else {
    span.appendChild(createRubyContainer({ rubyText: ruby, mainText: coreText }));
  }
}

function resolveWordsToRender(words, staggerMode) {
  if (staggerMode === 'word') {
    return aggregateLatinWords(words);
  }

  if (staggerMode === 'stagger') {
    return splitLatinWordsToChars(words);
  }

  return words;
}

// NativeAmllLyricsView builds its wave from individual Unicode characters,
// distributing each timed word's duration evenly across its characters.
function splitTimedWordsToCharacters(words) {
  return words.flatMap((word, wordIndex) => {
    if (word.ruby) return [word];
    const rawText = word.text || '';
    const leading = rawText.match(/^\s*/)?.[0] || '';
    const trailing = rawText.match(/\s*$/)?.[0] || '';
    const core = rawText.slice(leading.length, rawText.length - trailing.length);
    const characters = Array.from(core);
    if (characters.length <= 1) return [word];
    const duration = Number.isFinite(word.end) && word.end > word.time
      ? word.end - word.time
      : Math.max(0.001, word.duration || 0.3);
    return characters.map((character, index) => ({
      ...word,
      text: `${index === 0 ? leading : ''}${character}${index === characters.length - 1 ? trailing : ''}`,
      time: word.time + duration * index / characters.length,
      end: word.time + duration * (index + 1) / characters.length,
      duration: duration / characters.length,
      spaceBefore: index === 0 && word.spaceBefore,
      wrapGroup: wordIndex,
    }));
  });
}

export function renderTimedLyricWords({
  mainDiv,
  line,
  nextLine,
  staggerMode,
  compatibilityMode = 'auto',
}) {
  const charWords = [];
  const resolvedWords = resolveWordsToRender(line.words, staggerMode);
  // Only the letter-by-letter mode should split a timed word into characters.
  // Previously this ran for both modes, so switching between word lift and
  // letter lift rebuilt identical spans and appeared to do nothing.
  const wordsToRender = compatibilityMode !== 'line'
    && (compatibilityMode === 'char' || staggerMode === 'stagger')
    ? splitTimedWordsToCharacters(resolvedWords)
    : resolvedWords;

  let activeWrapGroup = null;
  let wrapContainer = null;

  wordsToRender.forEach((word, wordIndex) => {
    const rawText = word.text || '';
    const leadingMatch = rawText.match(/^(\s+)/);
    // TTML commonly stores the separator between timed spans as a text node
    // (or only exposes it through the parser's `spaceBefore` flag). Preserve
    // that separator when the word text itself has no leading whitespace.
    if (wordIndex > 0 && (leadingMatch || word.spaceBefore)) {
      activeWrapGroup = null;
      wrapContainer = null;
      mainDiv.appendChild(document.createTextNode(leadingMatch?.[1] || ' '));
    }

    const hasWrapGroup = Number.isInteger(word.wrapGroup);
    if (hasWrapGroup && word.wrapGroup !== activeWrapGroup) {
      wrapContainer = document.createElement('span');
      wrapContainer.className = 'lyrics-word-group';
      mainDiv.appendChild(wrapContainer);
      activeWrapGroup = word.wrapGroup;
    } else if (!hasWrapGroup) {
      activeWrapGroup = null;
      wrapContainer = null;
    }
    const appendTarget = hasWrapGroup && wrapContainer ? wrapContainer : mainDiv;

    const trailingMatch = rawText.match(/(\s+)$/);
    const coreText = rawText.replace(/^\s+/, '').replace(/\s+$/, '');

    if (coreText.length === 0) {
      activeWrapGroup = null;
      wrapContainer = null;
      if (trailingMatch && wordIndex > 0) {
        mainDiv.appendChild(document.createTextNode(trailingMatch[1]));
      } else if (rawText.length > 0) {
        mainDiv.appendChild(document.createTextNode(rawText));
      }
      return;
    }

    const nextWordTime = wordIndex + 1 < wordsToRender.length
      ? wordsToRender[wordIndex + 1].time
      : (line.end && line.end > word.time + 0.05
          ? line.end
          : (nextLine ? Math.min(word.time + 1.0, nextLine.time) : word.time + 0.5));
    // 保留相邻单元之间的原始时间空档。播放头会在空档内按实际文字几何位置
    // 经过空格；若把空档并入前一单元，高亮会直接跳过词间距。
    const explicitEnd = Number.isFinite(word.end) && word.end > word.time
      ? word.end
      : null;
    const sourceDuration = explicitEnd !== null
      ? explicitEnd - word.time
      : (word.duration || Math.max(0.01, nextWordTime - word.time));
    // 相邻时间单元共用同一个边界：当前单元的 end 就是下一单元的
    // begin。不要为了可见空格缩短时长，否则会凭空制造停顿。
    const wordDuration = sourceDuration;

    const span = document.createElement('span');
    span.className = 'lyrics-word';
    if (word.isBackground) {
      span.classList.add('is-background-word');
    }
    if (wordDuration >= 0.8) {
      span.classList.add('long-glow');
    }

    if (word.ruby) {
      const didSplitKanji = appendSplitKanjiRubyWords({
        mainDiv,
        charWords,
        coreText,
        ruby: word.ruby,
        time: word.time,
        duration: wordDuration,
      });

      if (didSplitKanji) {
        return;
      }

      appendRubyWord({ span, coreText, ruby: word.ruby });
    } else {
      span.textContent = coreText;
    }

    charWords.push({
      time: word.time,
      end: explicitEnd ?? (word.time + wordDuration),
      duration: wordDuration,
      topoPos: charWords.length,
      text: coreText,
    });

    const liftDuration = Math.max(0.15, Math.min(0.8, wordDuration * 1.5));
    span.style.setProperty('--lift-dur', `${liftDuration.toFixed(2)}s`);

    appendTarget.appendChild(span);

    if (trailingMatch) {
      appendTarget.appendChild(document.createTextNode(trailingMatch[1]));
    }
  });

  return charWords;
}
