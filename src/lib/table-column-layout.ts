import { getTableColumnCount, type TableDocument } from './table-document';

export const MIN_TABLE_COLUMN_WIDTH = 100;

/** 개행을 제외한 열별 전체 글자 수를 제곱근으로 보정해 너비 차이를 완화한다. */
export function getTableColumnTextWeights(document: TableDocument): number[] {
  const characterCounts = Array<number>(getTableColumnCount(document)).fill(0);
  for (const row of document.rows) {
    row.forEach((value, column) => {
      for (const character of value) {
        if (character !== '\r' && character !== '\n') characterCounts[column] += 1;
      }
    });
  }
  return characterCounts.map(count => Math.sqrt(count));
}

/** 최소 너비에 도달한 열을 고정하고 나머지 공간을 남은 열의 비율로 배분한다. */
export function allocateTableColumnWidths(weights: readonly number[], availableWidth: number): number[] {
  if (weights.length === 0) return [];
  let remainingWidth = Math.max(availableWidth, weights.length * MIN_TABLE_COLUMN_WIDTH);
  let remainingWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = Array<number>(weights.length).fill(MIN_TABLE_COLUMN_WIDTH);
  const columns = weights.map((weight, index) => ({ weight, index })).sort((a, b) => a.weight - b.weight);

  for (let position = 0; position < columns.length; position += 1) {
    const { weight, index } = columns[position];
    const remainingCount = columns.length - position;
    const proportionalWidth = remainingWeight > 0
      ? remainingWidth * weight / remainingWeight
      : remainingWidth / remainingCount;
    const width = Math.max(MIN_TABLE_COLUMN_WIDTH, proportionalWidth);
    widths[index] = width;
    remainingWidth -= width;
    remainingWeight -= weight;
  }
  return widths;
}
