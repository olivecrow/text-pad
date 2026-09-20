export type TableAlignment = 'left' | 'center' | 'right' | null;

/** 저장 형식과 독립된 표 데이터. 셀 값은 표시용 HTML이 아닌 텍스트다. */
export interface TableDocument {
  rows: string[][];
  columnAlignments?: TableAlignment[];
}

export interface TableCellSelection {
  row: number;
  column: number;
  start: number;
  end: number;
}

export interface TableDocumentChangeOptions {
  mergeKey?: string | null;
  cell?: TableCellSelection;
}

export function getTableColumnCount(document: TableDocument): number {
  return document.rows.reduce((count, row) => Math.max(count, row.length), 1);
}

function cloneRows<T extends TableDocument>(document: T): string[][] {
  return document.rows.map((row) => [...row]);
}

function withRows<T extends TableDocument>(document: T, rows: string[][]): T {
  return { ...document, rows: rows.length > 0 ? rows : [['']] };
}

function padRow(row: string[], columnCount: number): string[] {
  const nextRow = [...row];
  while (nextRow.length < columnCount) nextRow.push('');
  return nextRow;
}

export function updateTableCell<T extends TableDocument>(
  document: T,
  rowIndex: number,
  columnIndex: number,
  value: string
): T {
  const rows = [...document.rows];
  const columnCount = Math.max(getTableColumnCount(document), columnIndex + 1);
  const updatedRow = padRow(rows[rowIndex] ?? [], columnCount);
  updatedRow[columnIndex] = value;
  rows[rowIndex] = updatedRow;
  return withRows(document, rows);
}

export function insertTableRow<T extends TableDocument>(
  document: T,
  rowIndex: number
): T {
  const rows = cloneRows(document);
  const insertAt = Math.max(0, Math.min(rowIndex, rows.length));
  rows.splice(insertAt, 0, Array(getTableColumnCount(document)).fill(''));
  return withRows(document, rows);
}

export function removeTableRow<T extends TableDocument>(
  document: T,
  rowIndex: number
): T {
  const rows = cloneRows(document);
  if (rows.length <= 1) {
    return withRows(document, [Array(getTableColumnCount(document)).fill('')]);
  }
  rows.splice(Math.max(0, Math.min(rowIndex, rows.length - 1)), 1);
  return withRows(document, rows);
}

export function moveTableRow<T extends TableDocument>(
  document: T,
  fromIndex: number,
  toIndex: number
): T {
  const rows = cloneRows(document);
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) {
    return document;
  }
  const [movedRow] = rows.splice(fromIndex, 1);
  rows.splice(toIndex, 0, movedRow);
  return withRows(document, rows);
}

export function insertTableColumn<T extends TableDocument>(
  document: T,
  columnIndex: number
): T {
  const columnCount = getTableColumnCount(document);
  const insertAt = Math.max(0, Math.min(columnIndex, columnCount));
  const rows = document.rows.map((row) => {
    const nextRow = padRow(row, columnCount);
    nextRow.splice(insertAt, 0, '');
    return nextRow;
  });
  const next = withRows(document, rows);
  if (document.columnAlignments) {
    next.columnAlignments = [...document.columnAlignments];
    next.columnAlignments.splice(insertAt, 0, null);
  }
  return next;
}

export function removeTableColumn<T extends TableDocument>(
  document: T,
  columnIndex: number
): T {
  const columnCount = getTableColumnCount(document);
  if (columnCount <= 1) {
    return withRows(document, document.rows.map(() => ['']));
  }

  const removeAt = Math.max(0, Math.min(columnIndex, columnCount - 1));
  const rows = document.rows.map((row) => {
    const nextRow = padRow(row, columnCount);
    nextRow.splice(removeAt, 1);
    return nextRow;
  });
  const next = withRows(document, rows);
  if (document.columnAlignments) {
    next.columnAlignments = [...document.columnAlignments];
    next.columnAlignments.splice(removeAt, 1);
  }
  return next;
}

export function moveTableColumn<T extends TableDocument>(
  document: T,
  fromIndex: number,
  toIndex: number
): T {
  const columnCount = getTableColumnCount(document);
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= columnCount
    || toIndex >= columnCount
  ) {
    return document;
  }

  const rows = document.rows.map((row) => {
    const nextRow = padRow(row, columnCount);
    const [movedCell] = nextRow.splice(fromIndex, 1);
    nextRow.splice(toIndex, 0, movedCell);
    return nextRow;
  });
  const next = withRows(document, rows);
  if (document.columnAlignments) {
    next.columnAlignments = [...document.columnAlignments];
    const [alignment] = next.columnAlignments.splice(fromIndex, 1);
    next.columnAlignments.splice(toIndex, 0, alignment ?? null);
  }
  return next;
}
