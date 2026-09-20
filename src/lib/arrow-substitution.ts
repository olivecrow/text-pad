export interface ArrowSubstitutionEdit {
  content: string;
  selection: {
    start: number;
    end: number;
  };
}

const arrowSubstitutions: Record<string, string> = {
  '->': '→',
  '-->': '→',
  '<-': '←',
  '<--': '←',
  '<->': '↔',
  '<-->': '↔',
  '==>': '⇒',
  '<==': '⇐',
  '<=>': '⇔',
  '<==>': '⇔'
};

const arrowSubstitutionTriggers = Object.keys(arrowSubstitutions).sort((a, b) => b.length - a.length);

export function getArrowSubstitutionSpaceEdit(content: string, caret: number): ArrowSubstitutionEdit | null {
  if (!Number.isInteger(caret) || caret <= 0 || caret > content.length) return null;

  const trigger = arrowSubstitutionTriggers.find((candidate) => {
    const triggerStart = caret - candidate.length;
    if (triggerStart < 0) return false;
    if (content.slice(triggerStart, caret) !== candidate) return false;
    return triggerStart === 0 || /\s/u.test(content[triggerStart - 1]);
  });
  if (!trigger) return null;

  const triggerStart = caret - trigger.length;
  const substitution = arrowSubstitutions[trigger];
  const nextCaret = triggerStart + substitution.length + 1;

  return {
    content: `${content.slice(0, triggerStart)}${substitution} ${content.slice(caret)}`,
    selection: { start: nextCaret, end: nextCaret }
  };
}
