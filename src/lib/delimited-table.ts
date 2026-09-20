import type { TableDocument } from './table-document';
export {
  getTableColumnCount as getDelimitedTableColumnCount,
  updateTableCell as updateDelimitedTableCell,
  insertTableRow as insertDelimitedTableRow,
  removeTableRow as removeDelimitedTableRow,
  moveTableRow as moveDelimitedTableRow,
  insertTableColumn as insertDelimitedTableColumn,
  removeTableColumn as removeDelimitedTableColumn,
  moveTableColumn as moveDelimitedTableColumn
} from './table-document';

export type DelimitedTableSeparator = ',' | '\t';

export interface DelimitedTableDocument extends TableDocument {
  separator: DelimitedTableSeparator;
  lineEnding: '\r\n' | '\n' | '\r';
  hasTrailingLineEnding: boolean;
}

export interface DelimitedTableSyntaxError {
  line: number;
  column: number;
  offset: number;
}

export function getDelimitedTableSyntaxError(
  content: string,
  separator: DelimitedTableSeparator
): DelimitedTableSyntaxError | null {
  let line = 1;
  let column = 1;
  let isQuoted = false;
  let isAfterClosingQuote = false;
  let isAtCellStart = true;
  let openingQuote: DelimitedTableSyntaxError | null = null;

  const advanceLineEnding = (index: number): number => {
    const length = content[index] === '\r' && content[index + 1] === '\n' ? 2 : 1;
    line += 1;
    column = 1;
    return length;
  };

  for (let index = 0; index < content.length;) {
    const char = content[index];
    const lineEnding = getLineEndingAt(content, index);

    if (isQuoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          index += 2;
          column += 2;
          continue;
        }
        isQuoted = false;
        isAfterClosingQuote = true;
        index += 1;
        column += 1;
        continue;
      }
      if (lineEnding) {
        index += advanceLineEnding(index);
        continue;
      }
      index += 1;
      column += 1;
      continue;
    }

    if (isAfterClosingQuote) {
      if (char === separator) {
        isAfterClosingQuote = false;
        isAtCellStart = true;
        index += 1;
        column += 1;
        continue;
      }
      if (lineEnding) {
        isAfterClosingQuote = false;
        isAtCellStart = true;
        index += advanceLineEnding(index);
        continue;
      }
      return { line, column, offset: index };
    }

    if (char === '"') {
      if (!isAtCellStart) return { line, column, offset: index };
      isQuoted = true;
      isAtCellStart = false;
      openingQuote = { line, column, offset: index };
      index += 1;
      column += 1;
      continue;
    }
    if (char === separator) {
      isAtCellStart = true;
      index += 1;
      column += 1;
      continue;
    }
    if (lineEnding) {
      isAtCellStart = true;
      index += advanceLineEnding(index);
      continue;
    }
    isAtCellStart = false;
    index += 1;
    column += 1;
  }

  return isQuoted ? openingQuote : null;
}

function getLineEndingAt(content: string, index: number): DelimitedTableDocument['lineEnding'] | null {
  if (content[index] === '\r') {
    return content[index + 1] === '\n' ? '\r\n' : '\r';
  }
  return content[index] === '\n' ? '\n' : null;
}

function detectLineEnding(content: string): DelimitedTableDocument['lineEnding'] {
  for (let index = 0; index < content.length; index += 1) {
    const lineEnding = getLineEndingAt(content, index);
    if (lineEnding) return lineEnding;
  }
  return '\r\n';
}

export function parseDelimitedTable(
  content: string,
  separator: DelimitedTableSeparator
): DelimitedTableDocument {
  const document = parseDelimitedTableWithinCellLimit(content, separator);
  if (!document) {
    throw new Error('셀 제한이 없는 표 파싱은 실패할 수 없습니다.');
  }
  return document;
}

export function parseDelimitedTableWithinCellLimit(
  content: string,
  separator: DelimitedTableSeparator,
  maxCells: number = Number.POSITIVE_INFINITY
): DelimitedTableDocument | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let cellCount = 0;
  let isQuoted = false;
  let endedWithLineEnding = false;

  const appendCell = (): boolean => {
    cellCount += 1;
    if (cellCount > maxCells) return false;
    row.push(cell);
    cell = '';
    return true;
  };

  for (let index = 0; index < content.length;) {
    const char = content[index];

    if (isQuoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        isQuoted = false;
        index += 1;
        continue;
      }

      cell += char;
      index += 1;
      continue;
    }

    if (char === '"' && cell.length === 0) {
      isQuoted = true;
      endedWithLineEnding = false;
      index += 1;
      continue;
    }

    if (char === separator) {
      if (!appendCell()) return null;
      endedWithLineEnding = false;
      index += 1;
      continue;
    }

    const lineEnding = getLineEndingAt(content, index);
    if (lineEnding) {
      if (!appendCell()) return null;
      rows.push(row);
      row = [];
      endedWithLineEnding = true;
      index += lineEnding.length;
      continue;
    }

    cell += char;
    endedWithLineEnding = false;
    index += 1;
  }

  if (!endedWithLineEnding || row.length > 0 || cell.length > 0 || content.length === 0) {
    if (!appendCell()) return null;
    rows.push(row);
  }

  return {
    rows: rows.length > 0 ? rows : [['']],
    separator,
    lineEnding: detectLineEnding(content),
    hasTrailingLineEnding: content.length > 0 && endedWithLineEnding
  };
}

function serializeDelimitedCell(value: string, separator: DelimitedTableSeparator): string {
  if (!value.includes(separator) && !value.includes('"') && !/[\r\n]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeDelimitedTable(document: DelimitedTableDocument): string {
  const content = document.rows
    .map((row) => row.map((cell) => serializeDelimitedCell(cell, document.separator)).join(document.separator))
    .join(document.lineEnding);

  return document.hasTrailingLineEnding ? `${content}${document.lineEnding}` : content;
}
