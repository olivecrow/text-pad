export interface TextOffsetIndex {
  content: string;
  textareaValue: string;
  lineStartOffsets: number[];
  crlfContentOffsets: number[];
  crlfTextareaOffsets: number[];
}

function countOffsetsBefore(offsets: number[], target: number): number {
  let low = 0;
  let high = offsets.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }

  return low;
}

export function createTextOffsetIndex(content: string): TextOffsetIndex {
  const lineStartOffsets = [0];
  const crlfContentOffsets: number[] = [];
  const crlfTextareaOffsets: number[] = [];

  for (let offset = 0; offset < content.length; offset += 1) {
    if (content[offset] !== '\n') continue;
    lineStartOffsets.push(offset + 1);
    if (offset > 0 && content[offset - 1] === '\r') {
      const crlfOffset = offset - 1;
      crlfContentOffsets.push(crlfOffset);
      crlfTextareaOffsets.push(crlfOffset - (crlfContentOffsets.length - 1));
    }
  }

  return {
    content,
    textareaValue: crlfContentOffsets.length > 0 ? content.replace(/\r\n/g, '\n') : content,
    lineStartOffsets,
    crlfContentOffsets,
    crlfTextareaOffsets
  };
}

export function contentOffsetToTextareaOffset(index: TextOffsetIndex, offset: number): number {
  const target = Math.max(0, Math.min(offset, index.content.length));
  return target - countOffsetsBefore(index.crlfContentOffsets, target);
}

export function textareaOffsetToContentOffset(index: TextOffsetIndex, offset: number): number {
  const target = Math.max(0, Math.min(offset, index.textareaValue.length));
  return target + countOffsetsBefore(index.crlfTextareaOffsets, target);
}
