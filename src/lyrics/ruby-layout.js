export function splitKanjiUnits(text, ruby) {
  const units = [];

  for (let index = 0; index < text.length; index += 1) {
    if (/[\u4e00-\u9faf]/.test(text[index])) {
      if (units.length > 0) {
        units[units.length - 1].okurigana = text.substring(units[units.length - 1].endIdx, index);
      }

      units.push({
        kanji: text[index],
        okurigana: '',
        endIdx: index + 1,
      });
    }
  }

  if (units.length > 0) {
    units[units.length - 1].okurigana = text.substring(units[units.length - 1].endIdx);
  }

  if (units.length > 0 && ruby) {
    const rubyChars = Array.from(ruby);

    for (let index = 0; index < units.length && index < rubyChars.length; index += 1) {
      units[index].ruby = rubyChars[index];
    }

    if (rubyChars.length > units.length) {
      units[units.length - 1].ruby = rubyChars.slice(units.length - 1).join('');
    }
  }

  return units;
}
