export type CheckboxMarkerText = '[]' | '[V]';

export interface CheckboxMarker {
  indent: string;
  marker: CheckboxMarkerText;
  checked: boolean;
  spacing: ' ';
  prefix: string;
}

export interface CheckboxEnterEdit {
  text: string;
  caret: number;
}

export const uncheckedCheckboxPrefix = '[] ';

export function getCheckboxMarkerAtStart(text: string): CheckboxMarker | null {
  const match = text.match(/^([ \t]*)(\[\]|\[V\]) /u);
  const marker = match?.[2] as CheckboxMarkerText | undefined;
  if (!match || !marker) return null;

  const indent = match[1] ?? '';

  return {
    indent,
    marker,
    checked: marker === '[V]',
    spacing: ' ',
    prefix: `${indent}${marker} `
  };
}

export function getCheckboxEnterEdit(
  lineText: string,
  caret: number,
  newline: string
): CheckboxEnterEdit | null {
  const checkbox = getCheckboxMarkerAtStart(lineText);
  if (
    !checkbox
    || !Number.isInteger(caret)
    || caret < checkbox.prefix.length
    || caret > lineText.length
    || newline.length === 0
  ) return null;

  if (caret === lineText.length && lineText.length === checkbox.prefix.length) {
    return { text: checkbox.indent, caret: checkbox.indent.length };
  }

  const nextPrefix = `${checkbox.indent}${uncheckedCheckboxPrefix}`;
  return {
    text: `${lineText.slice(0, caret)}${newline}${nextPrefix}${lineText.slice(caret)}`,
    caret: caret + newline.length + nextPrefix.length
  };
}
