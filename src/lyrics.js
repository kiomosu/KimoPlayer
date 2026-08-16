// ── LRC/ELRC Parser (两遍扫描法：先解析所有行，再按时间戳分组合并翻译) ──

export function parseLRC(text) {
  const rawLines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Skip metadata
  const isMetadata = (line) => /^\[(?:ti|ar|al|by|offset|re|ve|id|length):/i.test(line);

  const parseTS = (str) => {
    const m = str.match(/(\d{1,2}):(\d{2})([.:])(\d{1,3})/);
    if (!m) return null;
    let ms = parseInt(m[4]);
    if (m[4].length === 2) ms *= 10;
    if (m[4].length === 1) ms *= 100;
    return parseInt(m[1]) * 60 + parseInt(m[2]) + ms / 1000;
  };

  const getFirstTS = (line) => {
    const m = line.match(/(?:\[(\d{1,2}:\d{2}[.:]\d{1,3})\]|<(\d{1,2}:\d{2}[.:]\d{1,3})>)/);
    const value = m ? (m[1] || m[2]) : null;
    return value ? parseTS(value) : null;
  };

  // ELRC uses <timestamp> for word boundaries, while enhanced LRC variants
  // may mix angle and square timestamp markers on the same line.
  const hasWordTiming = (line) => {
    const squareTimestamps = line.match(/\[\d{1,2}:\d{2}[.:]\d{1,3}\]/g) || [];
    const angleTimestamps = line.match(/<\d{1,2}:\d{2}[.:]\d{1,3}>/g) || [];
    // A line with only one timestamp at the front and one at the back is
    // line-timed, even when ELRC writes both markers with angle brackets.
    // Word timing needs at least one additional timestamp boundary.
    return squareTimestamps.length + angleTimestamps.length >= 3;
  };

  // Parse word-timed line into individual words (syllables)
  // ?� 借鉴 BetterLyrics：syllable 保留原始文本（含空格），不 trim；PrimaryText=Concat 天然保留空格 ?�
  const parseWords = (line) => {
    const words = [];
    const regex = /(?:\[(\d{1,2}:\d{2}[.:]\d{1,3})\]|<(\d{1,2}:\d{2}[.:]\d{1,3})>)([^\[\]<]*)/g;
    let lastTS = null;
    const segments = [...line.matchAll(regex)];

    segments.forEach((match, index) => {
      const time = parseTS(match[1] || match[2]);
      const text = match[3] || '';
      const nextTime = index + 1 < segments.length
        ? parseTS(segments[index + 1][1] || segments[index + 1][2])
        : null;
      if (time === null) return;
      lastTS = time;

      if (!text) return;
      if (/^\s+$/.test(text)) {
        // A timed whitespace segment is a gap between visible words, not a
        // karaoke word. Keep the separator on the preceding word while the
        // next visible word's timestamp preserves the actual gap duration.
        const previousWord = words[words.length - 1];
        if (previousWord) {
          if (!/\s$/.test(previousWord.text)) previousWord.text += text;
          previousWord.spaceAfter = true;
        }
        return;
      }

      words.push({
        time,
        end: nextTime,
        text,
        duration: nextTime !== null ? Math.max(0, nextTime - time) : 0,
        spaceAfter: /\s$/.test(text),
      });
    });
    return { words, lastTS };
  };

// Detect if text is primarily Latin (needs spaces between words)
const isLatin = (text) => /^[a-zA-Z\']/.test((text || '').trim());

// ?� 借鉴 BetterLyrics：PrimaryText = Concat(syllables.Text)，空格天然保留在原文中，无需补空格 ?�
const joinWords = (words) => {
  if (!words || words.length === 0) return '';
  return words.map(w => w.text).join('');
};

// ── Pass 1: Parse every line into an entry ──

  // Get plain text from a line (strip all timestamps)
  const getPlainText = (line) => {
    return line.replace(/(?:\[\d{1,2}:\d{2}[.:]\d{1,3}\]|<\d{1,2}:\d{2}[.:]\d{1,3}>)/g, '').trim();
  };

  const getLastTS = (line) => {
    const matches = [...line.matchAll(/(?:\[(\d{1,2}:\d{2}[.:]\d{1,3})\]|<(\d{1,2}:\d{2}[.:]\d{1,3})>)/g)];
    if (matches.length < 2) return null;
    const last = matches[matches.length - 1];
    return parseTS(last[1] || last[2]);
  };

  // ── Pass 1: Parse every line into an entry ──
  const entries = [];
  for (const line of rawLines) {
    if (isMetadata(line)) continue;
    const ts = getFirstTS(line);
    if (ts === null) continue;

    const isWordTimed = hasWordTiming(line);
    const parsed = isWordTimed ? parseWords(line) : null;
    const words = parsed ? parsed.words : null;
    const lastTS = parsed ? parsed.lastTS : getLastTS(line);
    const plainText = isWordTimed ? joinWords(words) : getPlainText(line);

    if (plainText.length === 0) continue;

    // ⭐ 规范化逐字数组：补齐最后一个字的 end/duration，避免 duration=0
    if (words && words.length >= 1) {
      const lineEnd = lastTS && lastTS > ts ? lastTS : (ts + 2.0);
      for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        if (!Number.isFinite(w.end) || w.end <= w.time) {
          const nextWord = words[wi + 1];
          if (nextWord && Number.isFinite(nextWord.time) && nextWord.time > w.time) {
            w.end = nextWord.time;
            w.duration = Math.max(0, nextWord.time - w.time);
          } else {
            const targetEnd = Math.max(w.time + 0.3, lineEnd);
            w.end = targetEnd;
            w.duration = Math.max(0.001, targetEnd - w.time);
          }
        }
        if (!Number.isFinite(w.duration) || w.duration <= 0) {
          w.duration = Math.max(0.001, w.end - w.time);
        }
      }
    }

    entries.push({
      time: ts,
      text: plainText,
      words,
      isWordTimed,
      timingFormat: isWordTimed
        ? (/<\d{1,2}:\d{2}[.:]\d{1,3}>/.test(line) ? 'enhanced-lrc' : 'word-lrc')
        : 'lrc',
      end: lastTS,
    });
  }

  // ── Pass 2: Group by timestamp, merge word-timed + plain as main + translation ──
  const result = [];
  const used = new Set();

  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;

    const entry = entries[i];

    // Look for a partner with the same timestamp (within 0.05s)
    let partnerIdx = -1;
    for (let j = 0; j < entries.length; j++) {
      if (j === i || used.has(j)) continue;
      if (Math.abs(entries[j].time - entry.time) < 0.05) {
        partnerIdx = j;
        break;
      }
    }

    if (partnerIdx >= 0) {
      const partner = entries[partnerIdx];
      used.add(i);
      used.add(partnerIdx);

      // The word-timed one is the main line, the other is translation
      let main, trans;
      if (entry.isWordTimed && !partner.isWordTimed) {
        main = entry; trans = partner;
      } else if (!entry.isWordTimed && partner.isWordTimed) {
        main = partner; trans = entry;
      } else {
        // Both same type: first one is main, second is translation
        main = entry; trans = partner;
      }

      result.push({
        time: main.time,
        text: main.text,
        words: main.words,
        timingFormat: main.timingFormat,
        translation: trans.text,
        translationEnd: trans.end,
        end: main.end,
      });
    } else {
      used.add(i);
      result.push({
        time: entry.time,
        text: entry.text,
        words: entry.words,
        timingFormat: entry.timingFormat,
        translation: null,
        end: entry.end,
      });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

// Explicit ELRC entry point for callers that already know the source format.
// parseLRC also auto-detects ELRC angle-bracket timestamps for providers that
// still label enhanced lyrics as plain "lrc".
export function parseELRC(text) {
  return parseLRC(text);
}

function getRobustAttribute(el, attrName) {
  if (!el || !el.attributes) return null;
  const normalizedName = String(attrName || '').toLowerCase();
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const name = String(attr.name || '').toLowerCase();
    const localName = String(attr.localName || '').toLowerCase();
    if (name === normalizedName
      || localName === normalizedName
      || name.endsWith(':' + normalizedName)) {
      return attr.value;
    }
  }
  return el.getAttribute(attrName);
}

function hasExplicitDuetRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return /(?:^|[-_\s])(?:l1|l2|v1|v2|voice1|voice2|vocal1|vocal2|singer1|singer2|lead1|lead2|both)(?:$|[-_\s])/.test(value);
}

function getExplicitDuetLane(role) {
  const value = String(role || '').trim().toLowerCase();
  const laneOne = /(?:^|[-_\s])(?:l1|v1|voice1|vocal1|singer1|lead1)(?:$|[-_\s])/.test(value);
  const laneTwo = /(?:^|[-_\s])(?:l2|v2|voice2|vocal2|singer2|lead2)(?:$|[-_\s])/.test(value);
  if (laneOne && !laneTwo) return 0;
  if (laneTwo && !laneOne) return 1;
  return null;
}

function getTTMLPreciseEnd(line) {
  if (Number.isFinite(line?.end) && line.end > line.time) return line.end;
  if (Array.isArray(line?.words) && line.words.length > 0) {
    const timedWords = line.words.filter(word => Number.isFinite(word?.end) && word.end > line.time);
    const lastWord = timedWords[timedWords.length - 1];
    if (lastWord) return lastWord.end;
  }
  return null;
}

// Infer only real lyric timing overlaps. `endTime` is deliberately excluded:
// the renderer pads it for scrolling, which would turn ordinary adjacent
// lyrics into a fake duet. Explicit ttm:agent/role or API isDuet remains
// authoritative.
export function assignDuetLanes(lines, { inferTiming = false } = {}) {
  const candidates = lines
    .filter(line => !line.isBackground && Number.isFinite(line.time))
    .sort((a, b) => a.time - b.time);
  const assigned = new Set();

  for (const line of candidates) {
    const sourceLane = Number(line.duetLane);
    const roleLane = getExplicitDuetLane(line.role);
    if (Number.isInteger(sourceLane)) {
      line.duetLane = Math.max(0, Math.min(1, sourceLane));
      assigned.add(line);
    } else if (roleLane !== null) {
      line.duetLane = roleLane;
      assigned.add(line);
    } else if (line.isDuet === true) {
      // LunaBeat/AMLL uses isDuet as a side flag: true means the secondary
      // singer row on the right. It is not a request to pair all marked rows
      // globally and alternate them between left and right.
      line.duetLane = 1;
      assigned.add(line);
    }
  }

  if (!inferTiming) return lines;

  for (let index = 0; index < candidates.length - 1; index += 1) {
    const first = candidates[index];
    const second = candidates[index + 1];
    if (assigned.has(first) || assigned.has(second)) continue;
    const firstEnd = getTTMLPreciseEnd(first);
    const secondEnd = getTTMLPreciseEnd(second);
    const startDistance = Math.abs(first.time - second.time);
    const sameStart = startDistance <= 0.01;
    const overlap = Number.isFinite(firstEnd) && Number.isFinite(secondEnd)
      ? Math.min(firstEnd, secondEnd) - Math.max(first.time, second.time)
      : 0;

    // A small tolerance covers timestamp rounding, while avoiding the
    // padded overlap used by the normal lyric scroll state.
    // Do not classify a long, sustained line and a later ordinary line as a
    // duet merely because their precise word ranges happen to overlap.
    if (sameStart || (startDistance <= 1.5 && overlap >= 0.12)) {
      first.duetLane = 0;
      second.duetLane = 1;
      first.isDuet = true;
      second.isDuet = true;
      assigned.add(first);
      assigned.add(second);
      index += 1;
    }
  }

  return lines;
}

// Convert local TTML/LRC, JSON, and LunaBeat responses into one canonical
// lyric-line shape before rendering or playback synchronization.
export function normalizeLyricsLines(lines, options = {}) {
  if (!Array.isArray(lines)) return [];
  const normalized = lines.map(line => {
    const words = Array.isArray(line?.words) ? line.words : null;
    const text = String(line?.text ?? (words ? words.map(word => word?.text || '').join('') : ''));
    const time = Number(line?.time);
    const end = Number(line?.end);
    const role = String(line?.role || '');
    const isBackground = Boolean(line?.isBackground ?? line?.isBG);
    const isDuet = Boolean(line?.isDuet || hasExplicitDuetRole(role));
    return {
      ...line,
      time: Number.isFinite(time) ? time : 0,
      end: Number.isFinite(end) && end > time ? end : (line?.end ?? null),
      text,
      words,
      role,
      isBackground,
      isDuet,
    };
  });
  return assignDuetLanes(normalized, options);
}

export function parseTTML(xmlText) {
  const result = [];
  const transMap = {};

  // Strip any leading/trailing LRC timestamps or non-XML characters to ensure DOMParser gets clean XML
  const startIndex = xmlText.indexOf('<');
  let cleanXml = startIndex >= 0 ? xmlText.substring(startIndex) : xmlText;
  const endIndex = cleanXml.lastIndexOf('>');
  if (endIndex >= 0) {
    cleanXml = cleanXml.substring(0, endIndex + 1);
  }
  cleanXml = cleanXml.trim();

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanXml, "text/xml");
  
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    console.error("[parseTTML Error] XML parsing failed:", parserError.textContent);
  }

  // 1. Extract transliterations (Furigana / Ruby) from <text> nodes in <head>
  const textElements = doc.querySelectorAll("text");
  textElements.forEach(textEl => {
    const lineKey = getRobustAttribute(textEl, "for");
    if (!lineKey) return;
    
    const transWords = [];
    const spanElements = textEl.querySelectorAll("span");
    spanElements.forEach(spanEl => {
      const beginVal = getRobustAttribute(spanEl, "begin");
      const endVal = getRobustAttribute(spanEl, "end");
      const begin = parseTTMLTime(beginVal);
      const end = parseTTMLTime(endVal);
      const text = spanEl.textContent.trim();
      if (begin !== null && end !== null && text) {
        transWords.push({ begin, end, text });
      }
    });
    transMap[lineKey] = transWords;
  });

  // 2. Parse paragraph <p> tags in <body>
  const pElements = doc.querySelectorAll("p");
  pElements.forEach((pEl, rowIdx) => {
    const beginVal = getRobustAttribute(pEl, "begin");
    if (!beginVal) return;
    const begin = parseTTMLTime(beginVal);

    const endVal = getRobustAttribute(pEl, "end");
    const end = endVal ? parseTTMLTime(endVal) : null;

    const key = getRobustAttribute(pEl, "key") || getRobustAttribute(pEl, "id") || "";
    
    let role = getRobustAttribute(pEl, "agent") || getRobustAttribute(pEl, "role") || "";
    const hasBackgroundMarker = (value) => /(?:^|[-_:])(?:xr-)?bg(?:$|[-_:])|background/i.test(value || '');
    const pAttributeValues = pEl.attributes
      ? Array.from(pEl.attributes).map(attribute => attribute.value).join(' ')
      : '';
    let isBackground = hasBackgroundMarker(role)
      || hasBackgroundMarker(pAttributeValues)
      || pEl.classList.contains("background");

    const spans = [];
    const backgroundGroups = [];
    let translation = null;
    let lastNodeWasSpace = false;
    let inParentheticalBackground = false;
    let backgroundWrapperDepth = 0;

    // Recursively process nodes to handle nested span elements and spaceBefore correctly
    const processNode = (node) => {
      if (node.nodeType === 3) { // TEXT_NODE
        const textVal = node.nodeValue;
        if (textVal && /\s/.test(textVal)) {
          lastNodeWasSpace = true;
        }
      } else if (node.nodeType === 1 && node.nodeName.toLowerCase() === "span") { // ELEMENT_NODE
        const spanAttrsRole = getRobustAttribute(node, "role");
        
        if (spanAttrsRole === "x-translation") {
          if (node.parentNode === pEl) {
            translation = node.textContent.trim();
          }
        } else if (spanAttrsRole === "x-bg") {
          // Some TTML writers put the background-vocal marker on a wrapper
          // span rather than on the paragraph itself. Keep it at word level
          // because one paragraph may contain both main and background text.
          const groupStart = spans.length;
          const groupTranslation = Array.from(node.querySelectorAll("span"))
            .find(child => getRobustAttribute(child, "role") === "x-translation")
            ?.textContent.trim() || null;
          backgroundWrapperDepth += 1;
          node.childNodes.forEach(child => processNode(child));
          backgroundWrapperDepth -= 1;
          const groupSpans = spans.splice(groupStart);
          if (groupSpans.length > 0) {
            backgroundGroups.push({ spans: groupSpans, translation: groupTranslation });
          }
        } else {
          const wBegin = parseTTMLTime(getRobustAttribute(node, "begin"));
          const wEnd = parseTTMLTime(getRobustAttribute(node, "end"));
          
          if (wBegin !== null) {
            // ?� 借鉴 BetterLyrics：保留原文（含空格），duration 由 begin/end 推断 ?�
            const rawText = node.textContent;
            // ⭐ 修复：同时检查前一个节点是否是空格，以及当前文本是否以空格开头 ⭐
            const hasLeadingSpace = /^\s/.test(rawText);
            spans.push({
              begin: wBegin,
              end: wEnd,
              text: rawText,
              duration: (wEnd && wBegin) ? (wEnd - wBegin) : 0,
              spaceBefore: lastNodeWasSpace || hasLeadingSpace,
              isBackground: backgroundWrapperDepth > 0
                || inParentheticalBackground
                || rawText.includes('('),
            });
            if (rawText.includes('(')) inParentheticalBackground = true;
            if (rawText.includes(')')) inParentheticalBackground = false;
            lastNodeWasSpace = false;
          } else {
            node.childNodes.forEach(child => processNode(child));
          }
        }
      }
    };

    pEl.childNodes.forEach(child => processNode(child));

    const lineTrans = transMap[key] || [];
    const words = [];
    
    for (const s of spans) {
      let ruby = null;
      if (s.begin !== null && s.end !== null) {
        // ?� 修复：用 filter 取所有匹配的 translit span 并拼接，避免 "何度" 只得到 "なん" 缺 "ど" ?�
        const matchTransAll = lineTrans.filter(t => {
          if (t.begin === null || t.end === null) return false;
          const start = Math.max(t.begin, s.begin);
          const end = Math.min(t.end, s.end);
          const overlap = end - start;
          const tDur = t.end - t.begin;
          if (overlap > 0 && (overlap / tDur) > 0.5) return true;
          if (t.begin >= s.begin - 0.05 && t.end <= s.end + 0.05) return true;
          return false;
        });
        if (matchTransAll.length > 0) {
          ruby = matchTransAll.map(t => t.text).join('');
        }
      }
      words.push({
        time: s.begin,
        end: s.end,
        text: s.text,
        duration: s.duration,
        ruby: ruby,
        spaceBefore: s.spaceBefore,
        isBackground: s.isBackground
      });
    }

    // Extract exact text using cloned element with translation removed
    let text = "";
    if (words.length > 0) {
      const clonedP = pEl.cloneNode(true);
      clonedP.querySelectorAll("span").forEach(s => {
        if (getRobustAttribute(s, "role") === "x-translation") {
          s.remove();
        }
        if (getRobustAttribute(s, "role") === "x-bg") {
          s.remove();
        }
      });
      text = clonedP.textContent.replace(/\s+/g, ' ').trim();

      // Some TTML producers omit the separator text node between adjacent
      // timed spans and rely on xml:space/word boundaries instead. The word
      // parser has already captured those boundaries in `spaceBefore`, so use
      // them to keep the line text consistent with the karaoke renderer.
      if (words.length > 1) {
        const wordText = words.map((word, index) => {
          const value = word.text || '';
          if (index === 0 || !word.spaceBefore || /^\s/.test(value)) return value;
          return ` ${value}`;
        }).join('');
        const normalizedWordText = wordText.replace(/\s+/g, ' ').trim();
        if (normalizedWordText) text = normalizedWordText;
      }
    } else {
      const clonedP = pEl.cloneNode(true);
      clonedP.querySelectorAll("span").forEach(s => {
        if (getRobustAttribute(s, "role") === "x-translation") {
          s.remove();
        }
      });
      text = clonedP.textContent.trim();
    }

    if (text.length > 0) {
      result.push({
        time: begin,
        end,
        text,
        translation,
        words: words.length > 1 ? words : null,
        role,
        isBackground,
        isDuet: hasExplicitDuetRole(role),
      });
    }

    // x-bg is a complete secondary lyric row nested inside the main <p>.
    // Emit it separately so it can be positioned, highlighted, and collapsed
    // independently while still sharing the main phrase's timing context.
    backgroundGroups.forEach(group => {
      const groupWords = group.spans.map(s => ({
        time: s.begin,
        end: s.end,
        text: s.text,
        duration: s.duration,
        ruby: null,
        spaceBefore: s.spaceBefore,
        // The emitted row itself carries isBackground. Do not apply the
        // inline background-word treatment a second time.
        isBackground: false,
      }));
      if (groupWords.length === 0) return;
      const groupText = groupWords.map((word, index) => {
        const value = word.text || '';
        return index > 0 && word.spaceBefore && !/^\s/.test(value) ? ` ${value}` : value;
      }).join('').replace(/\s+/g, ' ').trim();
      if (!groupText) return;
      result.push({
        time: groupWords[0].time,
        end: groupWords[groupWords.length - 1].end,
        text: groupText,
        translation: group.translation,
        words: groupWords,
        // Keep the parent singer lane so the background row sits directly
        // below the corresponding main line (left/right), while retaining
        // the background marker for its visual treatment.
        role: role ? `${role} xr-BG` : 'xr-BG',
        isBackground: true,
      });
    });
  });

  // Deduplicate and Sort
  const deduplicated = [];
  const seen = new Set();
  for (const item of result) {
    const key = `${item.time.toFixed(2)}_${item.text.substring(0, 20)}_${item.role || ''}_${item.isBackground ? 'bg' : 'fg'}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(item);
    }
  }
  deduplicated.sort((a, b) => a.time - b.time);
  return normalizeLyricsLines(deduplicated, { inferTiming: true });
}


function parseTTMLTime(timeStr) {
  if (!timeStr) return null;
  const hms = timeStr.match(/^(\d+):(\d+):(\d+)([.:]\d+)?$/);
  if (hms) return parseInt(hms[1]) * 3600 + parseInt(hms[2]) * 60 + parseInt(hms[3]) + (hms[4] ? parseFloat(hms[4].replace(':', '.')) : 0);
  const ms = timeStr.match(/^(\d+):(\d+)([.:]\d+)?$/);
  if (ms) return parseInt(ms[1]) * 60 + parseInt(ms[2]) + (ms[3] ? parseFloat(ms[3].replace(':', '.')) : 0);
  const secMatch = timeStr.match(/^(\d+\.?\d*)s?$/);
  if (secMatch) return parseFloat(secMatch[1]);
  return null;
}

export function parseJSONLyrics(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!data) return [];

    // ⭐ 兼容 LunaBeat API: { lines: [...], songwriters, source } 与通用格式 { lyrics: [...] }
    const rawLines = Array.isArray(data.lines) ? data.lines : (Array.isArray(data.lyrics) ? data.lyrics : []);
    if (rawLines.length === 0) return [];

    // 自动判断时间单位：样本中首行 startTime 若 > 1000 则视为毫秒（LunaBeat 嵌入式格式）
    const firstLine = rawLines[0];
    const probe = Number(firstLine.startTime ?? firstLine.time ?? 0);
    const msToSec = probe > 1000 ? 0.001 : 1;
    const toSec = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n * msToSec : null;
    };
    const toStr = (v, fb = '') => (v === undefined || v === null ? fb : String(v));

    // LunaBeat/AMLL 的逐字分词（character-level）会把「態度」拆成两个 word，各自带 romanWord=たい/ど，
    // 导致渲染层振假名被拆成多个独立注音段。这里和适配层保持一致：
    // 合并「连续纯汉字 + 时间无间隙 + 都有 ruby + isBackground 一致」的相邻 words。
    const GAP_EPSILON = 0.025;
    const isPureCJK = (text) => !!(text && /^[\u4e00-\u9faf\u3400-\u4dbf]+$/.test(text));
    const mergeCompounds = (words) => {
      if (!words || words.length <= 1) return words;
      const merged = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prev = merged.length > 0 ? merged[merged.length - 1] : null;
        const canMerge = prev
          && isPureCJK(prev.text)
          && isPureCJK(w.text)
          && prev.ruby
          && w.ruby
          && prev.isBackground === w.isBackground
          && Math.abs((prev.end || 0) - (w.time || 0)) < GAP_EPSILON;
        if (canMerge) {
          prev.text += w.text;
          prev.ruby += w.ruby;
          prev.end = Math.max(prev.end || 0, w.end || 0);
          prev.duration = Math.max(0.001, prev.end - prev.time);
          prev.spaceAfter = Boolean(w.spaceAfter);
        } else {
          merged.push(w);
        }
      }
      return merged;
    };

    // 规范化一个 word（兼容多种字段名）
    const normalizeWord = (w, idx, arr) => {
      const time = toSec(w.startTime ?? w.begin ?? w.time);
      const end = toSec(w.endTime ?? w.end);
      const text = toStr(w.word ?? w.text ?? w.syllable ?? '');
      const durationRaw = Number(w.duration);
      let duration = Number.isFinite(durationRaw) ? durationRaw * msToSec : null;
      let endFinal = end;
      // 互推 end / duration
      if (time !== null) {
        if (endFinal === null && duration !== null) {
          endFinal = time + duration;
        }
        if (endFinal !== null && (duration === null || !Number.isFinite(duration))) {
          duration = Math.max(0, endFinal - time);
        }
        if (endFinal === null && duration === null) {
          // 回退：下一字的 time 或 +0.3s
          const next = arr[idx + 1];
          const nextTime = next ? toSec(next.startTime ?? next.begin ?? next.time) : null;
          endFinal = nextTime !== null ? nextTime : (time + 0.3);
          duration = Math.max(0, endFinal - time);
        }
      }
      return {
        time: time ?? 0,
        end: endFinal ?? ((time ?? 0) + 0.3),
        duration: duration ?? 0.3,
        text,
        spaceAfter: Boolean(w.spaceAfter),
        spaceBefore: Boolean(w.spaceBefore),
        // ⭐ AMLL：romanWord / transliteration 是整段字的振假名（如「態度たいど」），
        // 需要按字数拆分分配，这里先原样挂到 word.ruby 上，
        // 真正拆分在 ruby-layout.js#splitKanjiUnits 中按 AMLL w1 算法完成
        ruby: w.ruby
          ? toStr(w.ruby)
          : (w.romanWord || w.transliteration ? toStr(w.romanWord || w.transliteration) : null),
        isBackground: Boolean(w.isBackground),
      };
    };

    const result = [];
    for (let i = 0; i < rawLines.length; i++) {
      const item = rawLines[i];
      const lineTime = toSec(item.startTime ?? item.begin ?? item.time);
      let lineEnd = toSec(item.endTime ?? item.end);
      const translation = toStr(item.translatedLyric ?? item.translation ?? item.subLines?.[0]?.text ?? '');
      const romanLyric = toStr(item.romanLyric ?? '');

      // 规范化 words（支持 words / syllables / 无）
      const rawWords = Array.isArray(item.words) ? item.words : (Array.isArray(item.syllables) ? item.syllables : null);
      let words = null;
      if (rawWords && rawWords.length >= 1) {
        words = rawWords.map((w, idx) => normalizeWord(w, idx, rawWords));
        const validWords = words.filter(w => (w.end - w.time) > 0.001);
        if (validWords.length === 0) {
          words = null;
        } else {
          // ⭐ 合并逐字拆分的 compound 汉字（態+度 → 態度 / たい+ど → たいど）
          words = mergeCompounds(words);
        }
      }

      // 从 words 推导出行级 text / end（若缺失）
      let text = toStr(item.text ?? '');
      if (!text && words) text = words.map(w => w.text).join('');
      if (lineTime === null) {
        lineTime = words?.[0]?.time ?? 0;
      }
      if (lineEnd === null) {
        if (words && words.length > 0) {
          lineEnd = words[words.length - 1].end;
        } else {
          const next = rawLines[i + 1];
          const nextTime = next ? toSec(next.startTime ?? next.begin ?? next.time) : null;
          lineEnd = nextTime !== null ? Math.max(lineTime + 0.5, nextTime) : (lineTime + 3);
        }
      }

      const isWordTimed = !!(words && words.length >= 1);
      result.push({
        time: lineTime,
        end: lineEnd,
        text,
        words,
        isWordTimed,
        timingFormat: isWordTimed ? 'word-lrc' : 'lrc',
        translation: translation || null,
        romanLyric: romanLyric || null,
        isBG: Boolean(item.isBG),
        isDuet: Boolean(item.isDuet),
      });
    }

    result.sort((a, b) => a.time - b.time);
    return normalizeLyricsLines(result);
  } catch (e) {
    console.error('[parseJSONLyrics] failed:', e);
    return [];
  }
}
