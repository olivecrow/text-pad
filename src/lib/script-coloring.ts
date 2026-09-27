export type TextScript = 'latin' | 'hangul' | 'han' | 'kana' | 'cyrillic' | 'greek' | 'arabic' | 'devanagari' | 'thai';

export interface ScriptRun {
  text: string;
  script: TextScript | null;
}

export interface WrapRun {
  text: string;
  protect: boolean;
}

const scriptPatterns: readonly [TextScript, RegExp][] = [
  ['latin', /\p{Script=Latin}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['han', /\p{Script=Han}/u],
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u]
];

const combiningMark = /\p{M}/u;

export function getScriptRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  for (const character of text) {
    const previous = runs[runs.length - 1];
    const script = (combiningMark.test(character) || (character === 'ー' && previous?.script === 'kana')) && previous
      ? previous.script
      : (scriptPatterns.find(([, pattern]) => pattern.test(character))?.[0] ?? null);
    const last = runs[runs.length - 1];
    if (last?.script === script) last.text += character;
    else runs.push({ text: character, script });
  }
  return runs;
}

export function getWrapRuns(text: string): WrapRun[] {
  return (text.match(/\s+|\S+/gu) ?? []).map(part => ({
    text: part,
    protect: !/^\s+$/u.test(part) && /[-/._:@\\]/u.test(part)
  }));
}

const richHighlights = new Map<TextScript, Highlight>();

export function registerRichScriptHighlights(root: HTMLElement): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return () => {};
  const ranges = new Map<TextScript, Range[]>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    let start = 0;
    for (const run of getScriptRuns(node.data)) {
      if (run.script) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + run.text.length);
        const list = ranges.get(run.script) ?? [];
        list.push(range);
        ranges.set(run.script, list);
      }
      start += run.text.length;
    }
    node = walker.nextNode() as Text | null;
  }
  for (const [script, selectedRanges] of ranges) {
    const name = `rich-script-${script}`;
    let highlight = richHighlights.get(script);
    if (!highlight) {
      highlight = new Highlight();
      richHighlights.set(script, highlight);
      CSS.highlights.set(name, highlight);
    }
    for (const range of selectedRanges) highlight.add(range);
  }
  return () => {
    for (const [script, selectedRanges] of ranges) {
      const highlight = richHighlights.get(script);
      if (!highlight) continue;
      for (const range of selectedRanges) highlight.delete(range);
      if (highlight.size === 0) {
        richHighlights.delete(script);
        CSS.highlights.delete(`rich-script-${script}`);
      }
    }
  };
}
