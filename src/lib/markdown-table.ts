import { getLineText } from './structured-rendering';
import { getTableColumnCount, type TableAlignment, type TableDocument } from './table-document';

export interface MarkdownTableCell {
  start: number;
  end: number;
  /** 표시 문자열의 각 경계를 실제 원문 위치에 연결한다. */
  offsets: number[];
}

export interface MarkdownTableBlock {
  startLine: number;
  endLine: number;
  start: number;
  end: number;
  source: string;
  lineEnding: string;
  document: TableDocument;
  cells: MarkdownTableCell[][];
}

interface ParsedRow {
  values: string[];
  cells: MarkdownTableCell[];
  columnCount: number;
}

const cellEntities: Record<string, string> = {
  '&#32;': ' ', '&#9;': '\t'
};

function parseRow(text: string, lineStart: number, maxColumns: number): ParsedRow | null {
  if (/^(?: {4}| *\t)/u.test(text)) return null;
  const pipes: number[] = [];
  let pipeCount = 0;
  let firstPipe = -1;
  let lastPipe = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
    } else if (text[index] === '|') {
      if (firstPipe < 0) firstPipe = index;
      lastPipe = index;
      pipeCount += 1;
      if (pipes.length <= maxColumns + 1) pipes.push(index);
    }
  }
  if (pipeCount === 0) return null;
  const hasLeadingPipe = text.slice(0, firstPipe).trim() === '';
  const hasTrailingPipe = text.slice(lastPipe + 1).trim() === '';
  const columnCount = pipeCount + 1 - Number(hasLeadingPipe) - Number(hasTrailingPipe);
  if (columnCount === 0) return null;
  // 예산을 넘는 행은 셀 값과 원문 경계 배열을 만들지 않는다.
  if (columnCount > maxColumns) return { values: [], cells: [], columnCount };
  const boundaries = [-1, ...pipes, text.length];
  if (hasLeadingPipe) boundaries.shift();
  if (hasTrailingPipe) boundaries.pop();
  const values: string[] = [];
  const cells: MarkdownTableCell[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    let start = boundaries[index - 1] + 1;
    let end = boundaries[index];
    while (start < end && /[ \t]/u.test(text[start])) start += 1;
    while (end > start && /[ \t]/u.test(text[end - 1])) end -= 1;
    let value = '';
    const offsets = [lineStart + start];
    const codeEnds = new Map<number, number>();
    const nextRun = new Map<number, { start: number; end: number }>();
    const runs = [...text.slice(start, end).matchAll(/`+/gu)];
    for (let run = runs.length - 1; run >= 0; run -= 1) {
      const part = runs[run];
      const next = nextRun.get(part[0].length);
      if (next) codeEnds.set(start + part.index!, next.end);
      nextRun.set(part[0].length, { start: start + part.index!, end: start + part.index! + part[0].length });
    }
    let codeUntil = start;
    for (let cursor = start; cursor < end;) {
      if (cursor >= codeUntil && codeEnds.has(cursor)) {
        let slashes = 0;
        for (let before = cursor - 1; before >= start && text[before] === '\\'; before -= 1) slashes += 1;
        if (slashes % 2 === 0) codeUntil = codeEnds.get(cursor)!;
      }
      if (text[cursor] === '\\' && (text[cursor + 1] === '|'
        || (text[cursor + 1] === '\\' && /^\\+\|/u.test(text.slice(cursor, end))))) {
        value += text[cursor + 1];
        cursor += 2;
      } else {
        const br = cursor >= codeUntil && text.slice(cursor, cursor + 6).match(/^<br\s*\/?>/iu);
        const entity = cursor >= codeUntil && text.slice(cursor, cursor + 6).match(/^(?:&#32;|&#9;)/u);
        if (br) {
          value += '\n';
          cursor += br[0].length;
        } else if (entity) {
          value += cellEntities[entity[0]];
          cursor += entity[0].length;
        } else {
          value += text[cursor];
          cursor += 1;
        }
      }
      offsets.push(lineStart + cursor);
    }
    values.push(value);
    cells.push({ start: lineStart + start, end: lineStart + end, offsets });
  }
  return { values, cells, columnCount };
}

function startsOtherBlock(text: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|<)/u.test(text);
}

/** 문서 안의 독립된 파이프 표만 찾고 코드, 주석, 과도한 셀 수는 원문 표시로 남긴다. */
export function parseMarkdownTables(
  content: string,
  lineStarts: number[],
  maxCells: number
): MarkdownTableBlock[] {
  const blocks: MarkdownTableBlock[] = [];
  let remainingCells = maxCells;
  let fence: { character: string; length: number } | null = null;
  let inComment = false;
  let listContentIndent: number | null = null;
  for (let line = 0; line < lineStarts.length - 1; line += 1) {
    const text = getLineText(content, lineStarts, line);
    if (fence) {
      const closing = text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = text.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!inComment && opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    if (inComment || text.includes('<!--')) {
      const commentStart: number = inComment ? 0 : text.indexOf('<!--') + 4;
      inComment = text.indexOf('-->', commentStart) < 0;
      continue;
    }
    const listMarker = text.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/u);
    if (listMarker) {
      const indent = listMarker[0].replace(/\t/gu, '    ').length;
      listContentIndent = Math.min(listContentIndent ?? indent, indent);
      continue;
    }
    if (listContentIndent !== null) {
      const indent = (text.match(/^[ \t]*/u)?.[0] ?? '').replace(/\t/gu, '    ').length;
      if (!text.trim() || indent >= listContentIndent) continue;
      listContentIndent = null;
    }
    if (startsOtherBlock(text)) continue;
    const header = parseRow(text, lineStarts[line], remainingCells);
    if (!header || header.columnCount > remainingCells) continue;
    const delimiterText = getLineText(content, lineStarts, line + 1);
    const delimiter = parseRow(delimiterText, lineStarts[line + 1], header.columnCount);
    if (!delimiter || delimiter.values.length !== header.values.length
      || !delimiter.values.every((value) => /^:?-+:?$/u.test(value))) continue;

    const columnCount = header.values.length;
    const alignments: TableAlignment[] = delimiter.values.map((value) => (
      value.startsWith(':') && value.endsWith(':') ? 'center'
        : value.endsWith(':') ? 'right' : value.startsWith(':') ? 'left' : null
    ));
    const rows = [header.values];
    const cells = [header.cells];
    let endLine = line + 1;
    let cellCount = columnCount;
    let supported = true;
    for (let bodyLine = line + 2; bodyLine < lineStarts.length; bodyLine += 1) {
      const bodyText = getLineText(content, lineStarts, bodyLine);
      if (startsOtherBlock(bodyText) || bodyText.includes('<!--')) break;
      const row = parseRow(bodyText, lineStarts[bodyLine], cellCount + columnCount <= remainingCells ? columnCount : 0);
      if (!row) break;
      endLine = bodyLine;
      cellCount += columnCount;
      // 넘치는 원문 셀을 버리는 대신 표 전체를 원문으로 보존한다.
      if (row.columnCount > columnCount) supported = false;
      if (cellCount > remainingCells || !supported) continue;
      while (row.values.length < columnCount) row.values.push('');
      rows.push(row.values);
      cells.push(row.cells);
    }
    if (supported && cellCount <= remainingCells) {
      const start = lineStarts[line];
      const end = lineStarts[endLine] + getLineText(content, lineStarts, endLine).length;
      blocks.push({
        startLine: line, endLine, start, end, source: content.slice(start, end),
        lineEnding: content.slice(start + text.length, lineStarts[line + 1]) || '\n',
        document: { rows, columnAlignments: alignments }, cells
      });
      remainingCells -= cellCount;
    }
    line = endLine;
  }
  return blocks;
}

export function encodeMarkdownTableCell(value: string): string {
  // 셀은 Markdown 원문이다. 태그·문자 참조·강조 이스케이프를 일반 문자로 바꾸지 않는다.
  return value.replace(/(\\*)\|/gu, (_, slashes: string) => '\\'.repeat(slashes.length * 2 + 1) + '|')
    .replace(/\r\n|\r|\n/gu, '<br>')
    .replace(/^[ \t]+|[ \t]+$/gu, (space) => space.replace(/ /gu, '&#32;').replace(/\t/gu, '&#9;'));
}

export function serializeMarkdownTable(document: TableDocument, lineEnding: string): string {
  const count = getTableColumnCount(document);
  const rowText = (row: string[]) => `| ${Array.from({ length: count }, (_, index) => (
    encodeMarkdownTableCell(row[index] ?? '')
  )).join(' | ')} |`;
  const delimiter = Array.from({ length: count }, (_, index) => {
    const alignment = document.columnAlignments?.[index];
    return alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : alignment === 'left' ? ':---' : '---';
  });
  return [rowText(document.rows[0] ?? []), rowText(delimiter), ...document.rows.slice(1).map(rowText)].join(lineEnding);
}

export function replaceMarkdownTable(
  content: string,
  block: MarkdownTableBlock,
  next: TableDocument,
  cell?: { row: number; column: number }
): string {
  // 드래그 애니메이션 도중 문서/탭이 바뀐 콜백은 오래된 범위를 쓰지 않는다.
  if (content.slice(block.start, block.end) !== block.source) return content;
  const range = cell ? block.cells[cell.row]?.[cell.column] : null;
  if (cell && range) {
    const value = encodeMarkdownTableCell(next.rows[cell.row]?.[cell.column] ?? '');
    return content.slice(0, range.start) + value + content.slice(range.end);
  }
  return content.slice(0, block.start) + serializeMarkdownTable(next, block.lineEnding) + content.slice(block.end);
}

export function getMarkdownTableCellAtOffset(block: MarkdownTableBlock, offset: number) {
  let closest = { row: 0, column: 0, offset: 0 };
  let distance = Number.POSITIVE_INFINITY;
  block.cells.forEach((row, rowIndex) => row.forEach((cell, column) => {
    cell.offsets.forEach((sourceOffset, index) => {
      const nextDistance = Math.abs(sourceOffset - offset);
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = { row: rowIndex, column, offset: index };
      }
    });
  }));
  return closest;
}
