import { parseJSONLyrics, parseLRC, parseELRC, parseTTML } from '../../lyrics.js';
import {
  formatLrcTime,
  formatLrcTimePrefix,
  formatTTMLTime,
  parseMinSecMsToSeconds,
} from '../../utils/time.js';

function escapeXml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseEditableLrc(rawText) {
  const lines = rawText.split('\n');
  const tempRows = [];
  let isWordTimedLrc = false;

  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;

    const rowTimeMatch = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    if (!rowTimeMatch) {
      tempRows.push({ time: 0, text: line, translation: null });
      return;
    }

    const rowTime = parseInt(rowTimeMatch[1], 10) * 60 + parseFloat(rowTimeMatch[2]);
    const remainingText = rowTimeMatch[3].trim();
    const inlineTimestampMatches = remainingText.match(/(?:<|\[)\d+:\d+(?:\.\d+)?(?:>|\])/g) || [];

    // A single trailing timestamp means [line start]text[line end], not a
    // one-word karaoke row. Enhanced word timing needs another inner marker.
    if (inlineTimestampMatches.length < 2) {
      const tailTimeMatch = remainingText.match(/^(.*?)\s*(?:\[|<)(\d+:\d+(?:\.\d+)?)(?:\]|>)\s*$/);
      tempRows.push({
        time: rowTime,
        text: tailTimeMatch ? tailTimeMatch[1].trim() : remainingText,
        end: tailTimeMatch ? parseMinSecMsToSeconds(tailTimeMatch[2]) : null,
        translation: null,
      });
      return;
    }

    isWordTimedLrc = true;
    const words = [];
    const wordRegex = /([^<\[]+)(?:<|\[)(\d+:\d+(?:\.\d+)?)(?:>|\])/g;
    let match;
    let lastEndTime = rowTime;

    while ((match = wordRegex.exec(remainingText)) !== null) {
      let wordText = match[1];
      const wordEndTime = parseMinSecMsToSeconds(match[2]);
      const duration = Math.max(0, wordEndTime - lastEndTime);
      const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(wordText);

      if (/^\s+$/.test(wordText)) {
        const previousWord = words[words.length - 1];
        if (previousWord) {
          if (!/\s$/.test(previousWord.text)) previousWord.text += wordText;
          previousWord.spaceAfter = true;
        }
        lastEndTime = wordEndTime;
        continue;
      }

      if (hasCJK) {
        wordText = wordText.trim();
      }

      words.push({
        time: lastEndTime,
        end: wordEndTime,
        duration,
        text: wordText,
        spaceAfter: /\s$/.test(wordText),
      });
      lastEndTime = wordEndTime;
    }

    if (words.length > 0) {
      tempRows.push({
        time: rowTime,
        text: remainingText,
        words,
        end: lastEndTime,
        translation: null,
      });
    } else {
      tempRows.push({ time: rowTime, text: remainingText, translation: null });
    }
  });

  const list = [];
  tempRows.forEach(row => {
    if (list.length > 0) {
      const lastRow = list[list.length - 1];
      if (Math.abs(row.time - lastRow.time) <= 0.15 && !lastRow.translation) {
        let textVal = row.text || '';
        let transEndTime = row.end ?? null;
        const tailTimeMatch = textVal.match(/^(.*?)\s*(?:\[|<)(\d+:\d+(?:\.\d+)?)(?:\]|>)\s*$/);

        if (tailTimeMatch) {
          textVal = tailTimeMatch[1].trim();
          transEndTime = parseMinSecMsToSeconds(tailTimeMatch[2]);
        }

        lastRow.translation = textVal;
        lastRow.translationTime = row.time;
        if (transEndTime) {
          lastRow.translationEnd = transEndTime;
        }
        return;
      }
    }

    list.push(row);
  });

  return {
    type: isWordTimedLrc ? 'word-lrc' : 'lrc',
    lyrics: list,
  };
}

export function parseEditableLyrics(rawText) {
  try {
    const parsed = parseJSONLyrics(rawText);
    if (parsed && parsed.length > 0 && parsed.some(item => item.words)) {
      return { type: 'json', lyrics: parsed };
    }
  } catch (error) {
    // Not JSON; continue trying other formats.
  }

  if (rawText.includes('<tt') || rawText.includes('xmlns="http://www.w3.org/ns/ttml"')) {
    return { type: 'ttml', lyrics: parseTTML(rawText) };
  }

  const isEnhancedLrc = /<\d+:\d+(?:\.\d+)?>/.test(rawText);
  const lyrics = isEnhancedLrc ? parseELRC(rawText) : parseLRC(rawText);
  const isWordTimedLrc = lyrics.some(row => Array.isArray(row.words) && row.words.length > 0);
  return {
    type: isEnhancedLrc ? 'enhanced-lrc' : (isWordTimedLrc ? 'word-lrc' : 'lrc'),
    lyrics,
  };
}

export function serializeTTML(lyricsList) {
  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<tt xml:lang="zh" xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">\n';
  xml += '  <head>\n    <metadata>\n      <ttm:title>Lyrics</ttm:title>\n';
  const rubyRows = lyricsList
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.words?.some(word => word.ruby));
  if (rubyRows.length > 0) {
    xml += '      <ttm:transliteration>\n';
    rubyRows.forEach(({ row, rowIndex }) => {
      xml += `        <ttm:text for="line-${rowIndex}">\n`;
      row.words.forEach(word => {
        if (!word.ruby) return;
        const wordEnd = word.end ?? (word.time + (word.duration || 0.1));
        xml += `          <ttm:span begin="${formatTTMLTime(word.time)}" end="${formatTTMLTime(wordEnd)}">${escapeXml(word.ruby)}</ttm:span>\n`;
      });
      xml += '        </ttm:text>\n';
    });
    xml += '      </ttm:transliteration>\n';
  }
  xml += '    </metadata>\n  </head>\n  <body>\n    <div>\n';

  lyricsList.forEach((row, rowIndex) => {
    const pBegin = formatTTMLTime(row.time);
    const pEnd = row.end ? formatTTMLTime(row.end) : null;
    let pAttr = `begin="${pBegin}" ttm:key="line-${rowIndex}"`;
    if (pEnd) pAttr += ` end="${pEnd}"`;
    const rowRole = row.role || row.tag || (row.isBackground ? 'x-bg' : '');
    if (rowRole) pAttr += ` ttm:role="${escapeXml(rowRole)}"`;

    xml += `      <p ${pAttr}>`;

    if (row.words && Array.isArray(row.words) && row.words.length > 0) {
      xml += '\n';
      row.words.forEach((word, index) => {
        const wordBegin = formatTTMLTime(word.time);
        const nextTime = index < row.words.length - 1
          ? row.words[index + 1].time
          : row.end || (word.time + (word.duration || 0.1));
        const wordEnd = formatTTMLTime(nextTime);
        const wordText = `${word.spaceBefore && index > 0 && !/^\s/.test(word.text || '') ? ' ' : ''}${word.text || ''}`;
        xml += `        <span begin="${wordBegin}" end="${wordEnd}">${escapeXml(wordText)}</span>\n`;
      });
      if (row.translation !== null && row.translation !== undefined) {
        xml += `        <span ttm:role="x-translation">${escapeXml(row.translation)}</span>\n`;
      }
      xml += '      </p>\n';
    } else {
      xml += `${escapeXml(row.text)}`;
      if (row.translation !== null && row.translation !== undefined) {
        xml += `<span ttm:role="x-translation">${escapeXml(row.translation)}</span>`;
      }
      xml += '</p>\n';
    }
  });

  xml += '    </div>\n  </body>\n</tt>';
  return xml;
}

export function serializeEditableLyrics({ lyricsList, lyricsType }) {
  if (lyricsType === 'ttml') {
    return serializeTTML(lyricsList);
  }

  if (lyricsType === 'json') {
    const list = lyricsList.map(row => {
      let rowText = row.text;
      if (row.words && Array.isArray(row.words)) {
        rowText = row.words.map(word => word.text).join('');
      }

      return {
        time: row.time,
        text: rowText,
        role: row.role || row.tag || null,
        tag: row.tag || row.role || null,
        isBackground: Boolean(row.isBackground),
        translation: row.translation || null,
        end: row.end || null,
        words: row.words ? row.words.map(word => ({
          time: word.time,
          end: word.end,
          duration: word.duration,
          text: word.text,
          ruby: word.ruby || null,
          spaceBefore: Boolean(word.spaceBefore),
        })) : null,
      };
    });

    return JSON.stringify({ lyrics: list });
  }

  const resultLines = [];
  lyricsList.forEach(row => {
    const rowTimeStr = formatLrcTimePrefix(row.time);

    if (
      (lyricsType === 'word-lrc' || lyricsType === 'enhanced-lrc')
      && row.words
      && Array.isArray(row.words)
    ) {
      const wordParts = row.words.map(word => {
        const endTimeStr = formatLrcTime(word.time + (word.duration || 0));
        return `${word.text || ''}[${endTimeStr}]`;
      }).join('');
      resultLines.push(`${rowTimeStr}${wordParts}`);
    } else {
      resultLines.push(`${rowTimeStr}${row.text || ''}`);
    }

    if (row.translation !== null && row.translation !== undefined) {
      const transTimeStr = formatLrcTimePrefix(row.translationTime ?? row.time);
      const transEndTimeStr = row.translationEnd !== undefined && row.translationEnd !== null
        ? `[${formatLrcTime(row.translationEnd)}]`
        : '';
      resultLines.push(`${transTimeStr}${row.translation}${transEndTimeStr}`);
    }
  });

  return resultLines.join('\n');
}
