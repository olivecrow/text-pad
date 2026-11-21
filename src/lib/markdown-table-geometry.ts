import type { CaretGeometry } from './editor-navigation';
import { getMarkdownTableCaretIndex, type MarkdownTableBlock } from './markdown-table';
import { createTextareaGeometry } from './textarea-geometry';

const tableBoundaryHeight = 4;

export function getMarkdownTableBoundaryRect(root: HTMLElement, before: boolean): DOMRect {
  const rect = root.getBoundingClientRect();
  const top = before ? rect.top : rect.bottom - tableBoundaryHeight;
  return new DOMRect(rect.left + 12, top, 1, tableBoundaryHeight);
}

/** 표 안에서는 셀의 실제 줄바꿈을 측정하고 표 앞뒤는 문서의 두 경계로 연결한다. */
export function createMarkdownTableGeometry(block: MarkdownTableBlock, root: HTMLElement): CaretGeometry {
  const index = getMarkdownTableCaretIndex(block);
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>('tr[data-table-row-container]'), row => {
    const rowIndex = Number(row.dataset.tableRowContainer);
    const cells = Array.from(row.querySelectorAll<HTMLTextAreaElement>('textarea[data-table-column]')).filter(input =>
      block.cells[rowIndex]?.[Number(input.dataset.tableColumn)]);
    return { rect: row.getBoundingClientRect(), cells };
  });
  const cellGeometries = new Map<HTMLTextAreaElement, ReturnType<typeof createTextareaGeometry>>();
  function measure(input: HTMLTextAreaElement) {
    let geometry = cellGeometries.get(input);
    if (!geometry) {
      geometry = createTextareaGeometry(input);
      cellGeometries.set(input, geometry);
    }
    return geometry;
  }

  return {
    rectAt(offset) {
      if (offset === block.start || offset === block.end) return getMarkdownTableBoundaryRect(root, offset === block.start);
      const position = index.cellAt(offset);
      if (!position) return null;
      const input = rows[position.row]?.cells[position.column];
      return input ? measure(input).rectAt(position.offset) : null;
    },
    offsetAt(x, y) {
      if (y < (rows[0]?.rect.top ?? Infinity) + tableBoundaryHeight) return block.start;
      if (y >= (rows.at(-1)?.rect.bottom ?? -Infinity)) return block.end;
      const row = rows.find(({ rect }) => y < rect.bottom);
      if (!row) return null;
      let closest: HTMLTextAreaElement | undefined;
      let distance = Infinity;
      for (const input of row.cells) {
        const rect = input.getBoundingClientRect();
        const delta = Math.max(rect.left - x, 0, x - rect.right);
        if (delta < distance) { closest = input; distance = delta; }
        if (delta === 0) break;
      }
      if (!closest) return null;
      const cell = block.cells[Number(closest.dataset.tableRow)][Number(closest.dataset.tableColumn)];
      const offset = measure(closest).offsetAt(x, y);
      const boundary = index.boundary(cell.offsets[offset] ?? cell.end, 0);
      // 외곽 파이프가 없으면 셀 안쪽 위치와 표 바깥 원문 경계가 겹칠 수 있다.
      if (boundary === block.start || boundary === block.end) {
        return index.adjacent(boundary, boundary === block.start ? 1 : -1) ?? boundary;
      }
      return boundary;
    },
    dispose() {
      for (const geometry of cellGeometries.values()) geometry.dispose();
    }
  };
}
