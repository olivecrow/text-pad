<script lang="ts">
  import { GripHorizontal, GripVertical, Minus, Plus } from '@lucide/svelte';
  import { flushSync } from 'svelte';
  import {
    getDelimitedTableColumnCount,
    insertDelimitedTableColumn,
    insertDelimitedTableRow,
    moveDelimitedTableColumn,
    moveDelimitedTableRow,
    removeDelimitedTableColumn,
    removeDelimitedTableRow,
    updateDelimitedTableCell,
    type DelimitedTableDocument
  } from './delimited-table';
  import { translate, type AppLocale, type TranslationKey, type TranslationValues } from './i18n';

  interface DocumentChangeOptions {
    mergeKey?: string | null;
  }

  interface DragPreviewController {
    update: (clientX: number, clientY: number) => void;
    animateTo: (translateX: number, translateY: number, duration: number) => Animation;
    destroy: () => void;
  }

  interface ReorderAnimationController {
    update: (targetIndex: number) => void;
    animate: (duration: number) => Animation[];
    destroy: () => void;
  }

  const DEFAULT_COLUMN_WIDTH = 160;
  const MIN_COLUMN_WIDTH = 72;
  const MAX_COLUMN_WIDTH = 640;
  const ROW_CONTROL_WIDTH = 43;

  interface Props {
    document: DelimitedTableDocument;
    formatLabel: string;
    locale: AppLocale;
    editable: boolean;
    highlightHeader: boolean;
    showRowIndices: boolean;
    animateReorder: boolean;
    reorderDurationMs: number;
    ondocumentchange: (document: DelimitedTableDocument, options?: DocumentChangeOptions) => void;
    onhighlightheaderchange: (enabled: boolean) => void;
    onshowrowindiceschange: (enabled: boolean) => void;
  }

  let {
    document,
    formatLabel,
    locale,
    editable,
    highlightHeader,
    showRowIndices,
    animateReorder,
    reorderDurationMs,
    ondocumentchange,
    onhighlightheaderchange,
    onshowrowindiceschange
  }: Props = $props();

  function t(key: TranslationKey, values: TranslationValues = {}) {
    return translate(locale, key, values);
  }

  let tableEditorEl = $state<HTMLDivElement | null>(null);
  let dragPreviewHostEl = $state<HTMLDivElement | null>(null);
  let selectedRow = $state(0);
  let selectedColumn = $state(0);
  let draggedRow = $state<number | null>(null);
  let draggedColumn = $state<number | null>(null);
  let rowDropBoundary: number | null = null;
  let columnDropBoundary: number | null = null;
  let rowDropIndicatorElement: HTMLElement | null = null;
  let columnDropIndicatorElement: HTMLElement | null = null;
  let columnWidths = $state<number[]>([]);
  let resizingColumn = $state<number | null>(null);
  let columnCount = $derived(getDelimitedTableColumnCount(document));
  let safeReorderDurationMs = $derived.by(() => {
    const numericDuration = Number(reorderDurationMs);
    if (!Number.isFinite(numericDuration)) return 150;
    return Math.max(50, Math.min(2000, Math.round(numericDuration / 50) * 50));
  });
  let tablePixelWidth = $derived(
    ROW_CONTROL_WIDTH
      + Array.from(
        { length: columnCount },
        (_, columnIndex) => columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH
      ).reduce((total, width) => total + width, 0)
  );

  $effect(() => {
    selectedRow = Math.max(0, Math.min(selectedRow, document.rows.length - 1));
    selectedColumn = Math.max(0, Math.min(selectedColumn, columnCount - 1));
  });

  $effect(() => {
    if (columnWidths.length === columnCount) return;
    columnWidths = Array.from(
      { length: columnCount },
      (_, columnIndex) => clampColumnWidth(columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH)
    );
  });

  function clampColumnWidth(width: number): number {
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
  }

  function getColumnWidth(columnIndex: number): number {
    return clampColumnWidth(columnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH);
  }

  function getNormalizedColumnWidths(): number[] {
    return Array.from({ length: columnCount }, (_, columnIndex) => getColumnWidth(columnIndex));
  }

  function setColumnWidth(columnIndex: number, width: number) {
    const nextWidths = getNormalizedColumnWidths();
    nextWidths[columnIndex] = clampColumnWidth(width);
    columnWidths = nextWidths;
  }

  function insertColumnWidth(columnIndex: number) {
    const nextWidths = getNormalizedColumnWidths();
    nextWidths.splice(columnIndex, 0, DEFAULT_COLUMN_WIDTH);
    columnWidths = nextWidths;
  }

  function removeColumnWidth(columnIndex: number) {
    if (columnCount <= 1) {
      columnWidths = [DEFAULT_COLUMN_WIDTH];
      return;
    }
    const nextWidths = getNormalizedColumnWidths();
    nextWidths.splice(columnIndex, 1);
    columnWidths = nextWidths;
  }

  function moveColumnWidth(fromIndex: number, toIndex: number) {
    const nextWidths = getNormalizedColumnWidths();
    const [movedWidth] = nextWidths.splice(fromIndex, 1);
    nextWidths.splice(toIndex, 0, movedWidth);
    columnWidths = nextWidths;
  }

  function getColumnLabel(index: number): string {
    let label = '';
    let current = index + 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      current = Math.floor((current - 1) / 26);
    }
    return label;
  }

  function getColumnName(index: number): string {
    const headerValue = (document.rows[0]?.[index] ?? '').trim();
    return headerValue
      ? t('table.columnWithHeader', { header: headerValue })
      : t('table.column', { column: getColumnLabel(index) });
  }

  function selectCell(rowIndex: number, columnIndex: number) {
    selectedRow = rowIndex;
    selectedColumn = columnIndex;
  }

  function addRowAt(insertAt: number) {
    if (!editable) return;
    const safeInsertAt = Math.max(0, Math.min(insertAt, document.rows.length));
    ondocumentchange(insertDelimitedTableRow(document, safeInsertAt));
    selectedRow = safeInsertAt;
  }

  function removeRowAt(rowIndex: number) {
    if (!editable) return;
    ondocumentchange(removeDelimitedTableRow(document, rowIndex));
    selectedRow = Math.max(0, Math.min(rowIndex, document.rows.length - 2));
  }

  function addColumnAt(insertAt: number) {
    if (!editable) return;
    const safeInsertAt = Math.max(0, Math.min(insertAt, columnCount));
    insertColumnWidth(safeInsertAt);
    ondocumentchange(insertDelimitedTableColumn(document, safeInsertAt));
    selectedColumn = safeInsertAt;
  }

  function removeColumnAt(columnIndex: number) {
    if (!editable) return;
    removeColumnWidth(columnIndex);
    ondocumentchange(removeDelimitedTableColumn(document, columnIndex));
    selectedColumn = Math.max(0, Math.min(columnIndex, columnCount - 2));
  }

  function stopEdgeActionPointer(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleCellInput(event: Event, rowIndex: number, columnIndex: number) {
    if (!editable) return;
    const value = (event.currentTarget as HTMLTextAreaElement).value;
    ondocumentchange(
      updateDelimitedTableCell(document, rowIndex, columnIndex, value),
      { mergeKey: `delimited-cell:${rowIndex}:${columnIndex}` }
    );
  }

  function focusCell(rowIndex: number, columnIndex: number) {
    requestAnimationFrame(() => {
      tableEditorEl
        ?.querySelector<HTMLTextAreaElement>(`[data-table-row="${rowIndex}"][data-table-column="${columnIndex}"]`)
        ?.focus();
    });
  }

  function focusRowHandle(rowIndex: number) {
    requestAnimationFrame(() => {
      tableEditorEl
        ?.querySelector<HTMLElement>(
          `[data-table-row-container="${rowIndex}"] .row-drag-handle`
        )
        ?.focus({ preventScroll: true });
    });
  }

  function focusColumnHandle(columnIndex: number) {
    requestAnimationFrame(() => {
      tableEditorEl
        ?.querySelector<HTMLElement>(
          `th[data-table-column-container="${columnIndex}"] .column-drag-handle`
        )
        ?.focus({ preventScroll: true });
    });
  }

  function handleCellKeydown(event: KeyboardEvent, rowIndex: number, columnIndex: number) {
    if (event.key !== 'Tab') return;
    event.preventDefault();

    const direction = event.shiftKey ? -1 : 1;
    const flatIndex = rowIndex * columnCount + columnIndex + direction;
    const cellCount = document.rows.length * columnCount;
    const wrappedIndex = (flatIndex + cellCount) % cellCount;
    const nextRow = Math.floor(wrappedIndex / columnCount);
    const nextColumn = wrappedIndex % columnCount;
    selectCell(nextRow, nextColumn);
    focusCell(nextRow, nextColumn);
  }

  function clearDragState() {
    draggedRow = null;
    draggedColumn = null;
    setRowDropBoundary(null);
    setColumnDropBoundary(null);
  }

  function getRowDropBoundaryAtPoint(clientX: number, clientY: number): number | null {
    const element = globalThis.document.elementFromPoint(clientX, clientY);
    const rowElement = element?.closest<HTMLElement>('[data-table-row-container]');
    const rowIndex = Number(rowElement?.dataset.tableRowContainer);
    if (!rowElement || !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= document.rows.length) {
      return null;
    }
    const rowRect = rowElement.getBoundingClientRect();
    return rowIndex + (clientY >= rowRect.top + rowRect.height / 2 ? 1 : 0);
  }

  function getColumnDropBoundaryAtPoint(clientX: number, clientY: number): number | null {
    const element = globalThis.document.elementFromPoint(clientX, clientY);
    const columnElement = element?.closest<HTMLElement>('[data-table-column-container]');
    const columnIndex = Number(columnElement?.dataset.tableColumnContainer);
    if (!columnElement || !Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= columnCount) {
      return null;
    }
    const columnRect = columnElement.getBoundingClientRect();
    return columnIndex + (clientX >= columnRect.left + columnRect.width / 2 ? 1 : 0);
  }

  function getMoveTargetIndex(fromIndex: number, dropBoundary: number, itemCount: number): number {
    const insertionIndex = dropBoundary > fromIndex ? dropBoundary - 1 : dropBoundary;
    return Math.max(0, Math.min(insertionIndex, itemCount - 1));
  }

  function createDropIndicator(axis: 'row' | 'column'): HTMLElement | null {
    if (!dragPreviewHostEl) return null;
    const indicator = globalThis.document.createElement('div');
    indicator.className = `table-drop-indicator ${axis}-drop-indicator`;
    indicator.dataset.dropAxis = axis;
    indicator.setAttribute('aria-hidden', 'true');
    dragPreviewHostEl.append(indicator);
    return indicator;
  }

  function setRowDropBoundary(dropBoundary: number | null) {
    if (dropBoundary === null) {
      rowDropIndicatorElement?.remove();
      rowDropIndicatorElement = null;
      rowDropBoundary = null;
      return;
    }
    if (rowDropBoundary === dropBoundary && rowDropIndicatorElement) return;

    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    const table = tableEditorEl?.querySelector<HTMLTableElement>('.data-table');
    const referenceRowIndex = Math.min(dropBoundary, document.rows.length - 1);
    const referenceRow = tableEditorEl?.querySelector<HTMLElement>(
      `[data-table-row-container="${referenceRowIndex}"]`
    );
    if (!scrollRegion || !table || !referenceRow) return;

    const scrollRect = scrollRegion.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const rowRect = referenceRow.getBoundingClientRect();
    const left = Math.max(tableRect.left, scrollRect.left);
    const right = Math.min(tableRect.right, scrollRect.right);
    const top = dropBoundary >= document.rows.length ? rowRect.bottom : rowRect.top;
    if (right <= left) return;

    rowDropIndicatorElement ??= createDropIndicator('row');
    if (!rowDropIndicatorElement) return;
    rowDropIndicatorElement.dataset.dropBoundary = String(dropBoundary);
    rowDropIndicatorElement.style.left = `${left}px`;
    rowDropIndicatorElement.style.top = `${top}px`;
    rowDropIndicatorElement.style.width = `${right - left}px`;
    rowDropBoundary = dropBoundary;
  }

  function setColumnDropBoundary(dropBoundary: number | null) {
    if (dropBoundary === null) {
      columnDropIndicatorElement?.remove();
      columnDropIndicatorElement = null;
      columnDropBoundary = null;
      return;
    }
    if (columnDropBoundary === dropBoundary && columnDropIndicatorElement) return;

    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    const table = tableEditorEl?.querySelector<HTMLTableElement>('.data-table');
    const referenceColumnIndex = Math.min(dropBoundary, columnCount - 1);
    const referenceColumn = tableEditorEl?.querySelector<HTMLElement>(
      `th[data-table-column-container="${referenceColumnIndex}"]`
    );
    if (!scrollRegion || !table || !referenceColumn) return;

    const scrollRect = scrollRegion.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const columnRect = referenceColumn.getBoundingClientRect();
    const top = Math.max(tableRect.top, scrollRect.top);
    const bottom = Math.min(tableRect.bottom, scrollRect.bottom);
    const left = dropBoundary >= columnCount ? columnRect.right : columnRect.left;
    if (bottom <= top) return;

    columnDropIndicatorElement ??= createDropIndicator('column');
    if (!columnDropIndicatorElement) return;
    columnDropIndicatorElement.dataset.dropBoundary = String(dropBoundary);
    columnDropIndicatorElement.style.left = `${left}px`;
    columnDropIndicatorElement.style.top = `${top}px`;
    columnDropIndicatorElement.style.height = `${bottom - top}px`;
    columnDropBoundary = dropBoundary;
  }

  function syncDragPreviewFormValues(source: Element, preview: Element) {
    const sourceTextareas = source.querySelectorAll<HTMLTextAreaElement>('textarea');
    const previewTextareas = preview.querySelectorAll<HTMLTextAreaElement>('textarea');
    previewTextareas.forEach((textarea, index) => {
      textarea.value = sourceTextareas[index]?.value ?? '';
      textarea.tabIndex = -1;
    });
    preview.querySelectorAll<HTMLElement>('button, [tabindex]').forEach((element) => {
      element.tabIndex = -1;
    });
  }

  function getVisibleTableRows(): HTMLTableRowElement[] {
    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    const table = tableEditorEl?.querySelector<HTMLTableElement>('.data-table');
    if (!scrollRegion || !table) return [];

    const scrollRect = scrollRegion.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const clipLeft = Math.max(tableRect.left, scrollRect.left);
    const clipRight = Math.min(tableRect.right, scrollRect.right);
    const clipTop = Math.max(tableRect.top, scrollRect.top);
    const clipBottom = Math.min(tableRect.bottom, scrollRect.bottom);
    if (clipRight <= clipLeft || clipBottom <= clipTop) return [];

    const hitTestX = Math.min(
      Math.max(tableRect.left + ROW_CONTROL_WIDTH / 2, clipLeft + 1),
      clipRight - 1
    );
    const visibleRows: HTMLTableRowElement[] = [];
    const seenRows = new Set<HTMLTableRowElement>();
    let hitTestY = clipTop + 1;
    const maximumChecks = Math.ceil((clipBottom - clipTop) / 4) + 32;

    for (let check = 0; check < maximumChecks && hitTestY < clipBottom; check += 1) {
      const hitElement = globalThis.document.elementFromPoint(hitTestX, hitTestY);
      const row = hitElement?.closest<HTMLTableRowElement>('[data-table-row-container]');
      if (!row || !table.contains(row)) {
        hitTestY += 8;
        continue;
      }

      const rowRect = row.getBoundingClientRect();
      if (!seenRows.has(row) && rowRect.bottom > clipTop && rowRect.top < clipBottom) {
        visibleRows.push(row);
        seenRows.add(row);
      }
      hitTestY = rowRect.bottom > hitTestY ? rowRect.bottom + 1 : hitTestY + 8;
    }

    return visibleRows;
  }

  function getVisibleColumnElements(
    columnIndex: number,
    visibleRows = getVisibleTableRows()
  ): HTMLElement[] {
    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    if (!scrollRegion) return [];
    const scrollRect = scrollRegion.getBoundingClientRect();

    return visibleRows.flatMap((row) => {
      const cell = row.querySelector<HTMLElement>(
        `[data-table-column-container="${columnIndex}"]`
      );
      if (!cell) return [];
      const cellRect = cell.getBoundingClientRect();
      return cellRect.right > scrollRect.left
        && cellRect.left < scrollRect.right
        && cellRect.bottom > scrollRect.top
        && cellRect.top < scrollRect.bottom
        ? [cell]
        : [];
    });
  }

  function shouldAnimateReorder(): boolean {
    return animateReorder;
  }

  function createReorderAnimationController(
    axis: 'row' | 'column',
    sourceIndex: number,
    itemCount: number
  ): ReorderAnimationController | null {
    if (!shouldAnimateReorder()) return null;

    const visibleRows = getVisibleTableRows();
    const elementsByIndex = new Map<number, HTMLElement[]>();
    if (axis === 'row') {
      visibleRows.forEach((row) => {
        const rowIndex = Number(row.dataset.tableRowContainer);
        if (Number.isInteger(rowIndex)) elementsByIndex.set(rowIndex, [row]);
      });
    } else {
      visibleRows.forEach((row) => {
        row.querySelectorAll<HTMLElement>('[data-table-column-container]').forEach((cell) => {
          const columnIndex = Number(cell.dataset.tableColumnContainer);
          if (!Number.isInteger(columnIndex)) return;
          const cells = elementsByIndex.get(columnIndex) ?? [];
          cells.push(cell);
          elementsByIndex.set(columnIndex, cells);
        });
      });
    }

    const sourceElements = elementsByIndex.get(sourceIndex) ?? [];
    const sourceRect = sourceElements[0]?.getBoundingClientRect();
    const sourceSize = axis === 'row' ? sourceRect?.height : sourceRect?.width;
    if (!sourceSize || sourceElements.length === 0) return null;

    const shiftedElements: HTMLElement[] = [];
    let preparedShift = 0;
    sourceElements.forEach((element) => element.classList.add('table-reorder-source'));

    return {
      update(targetIndex) {
        if (shiftedElements.length > 0) return;
        const safeTargetIndex = Math.max(0, Math.min(targetIndex, itemCount - 1));
        const firstShiftedIndex = safeTargetIndex > sourceIndex ? sourceIndex + 1 : safeTargetIndex;
        const lastShiftedIndex = safeTargetIndex > sourceIndex ? safeTargetIndex : sourceIndex - 1;
        preparedShift = safeTargetIndex > sourceIndex ? -sourceSize : sourceSize;

        if (safeTargetIndex !== sourceIndex) {
          for (let index = firstShiftedIndex; index <= lastShiftedIndex; index += 1) {
            for (const element of elementsByIndex.get(index) ?? []) {
              element.classList.add('table-reorder-shift');
              shiftedElements.push(element);
            }
          }
        }

      },
      animate(duration) {
        const targetTransform = axis === 'row'
          ? `translate3d(0, ${preparedShift}px, 0)`
          : `translate3d(${preparedShift}px, 0, 0)`;
        return shiftedElements.map((element) => element.animate(
          [
            { transform: 'translate3d(0, 0, 0)' },
            { transform: targetTransform }
          ],
          {
            duration,
            easing: 'ease-out',
            fill: 'forwards'
          }
        ));
      },
      destroy() {
        sourceElements.forEach((element) => element.classList.remove('table-reorder-source'));
        shiftedElements.forEach((element) => {
          element.classList.remove('table-reorder-shift');
        });
      }
    };
  }

  function createDragPreviewController(
    preview: HTMLElement,
    sourceElements: HTMLElement[],
    axis: 'row' | 'column',
    startClientX: number,
    startClientY: number
  ): DragPreviewController {
    let animationFrame: number | null = null;
    let translateX = 0;
    let translateY = 0;

    const renderFrame = () => {
      animationFrame = null;
      preview.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
    };

    return {
      update(clientX, clientY) {
        translateX = axis === 'column' ? clientX - startClientX : 0;
        translateY = axis === 'row' ? clientY - startClientY : 0;
        if (animationFrame === null) {
          animationFrame = globalThis.requestAnimationFrame(renderFrame);
        }
      },
      animateTo(nextTranslateX, nextTranslateY, duration) {
        if (animationFrame !== null) {
          globalThis.cancelAnimationFrame(animationFrame);
          renderFrame();
        }
        return preview.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: `translate3d(${nextTranslateX}px, ${nextTranslateY}px, 0)` }
          ],
          {
            duration,
            easing: 'ease-out',
            fill: 'forwards'
          }
        );
      },
      destroy() {
        if (animationFrame !== null) globalThis.cancelAnimationFrame(animationFrame);
        sourceElements.forEach((element) => element.classList.remove('table-drag-source'));
        preview.remove();
      }
    };
  }

  function playReorderAnimation(
    dragPreview: DragPreviewController,
    reorderAnimation: ReorderAnimationController,
    targetTranslateX: number,
    targetTranslateY: number,
    oncomplete: () => void
  ) {
    const duration = safeReorderDurationMs;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let completed = false;
    const animations = [
      dragPreview.animateTo(targetTranslateX, targetTranslateY, duration),
      ...reorderAnimation.animate(duration)
    ];

    const finishAnimation = () => {
      if (completed) return;
      completed = true;
      if (fallbackTimer !== null) globalThis.clearTimeout(fallbackTimer);
      animations.forEach((animation) => {
        try {
          animation.finish();
        } catch {
          // 제거된 요소처럼 끝낼 수 없는 애니메이션은 최종 데이터 반영으로 복구한다.
        }
      });
      oncomplete();
      animations.forEach((animation) => animation.cancel());
    };

    Promise.allSettled(animations.map((animation) => animation.finished))
      .then(finishAnimation);
    fallbackTimer = globalThis.setTimeout(finishAnimation, duration + 250);
  }

  function createRowDragPreview(
    rowIndex: number,
    startClientX: number,
    startClientY: number
  ): DragPreviewController | null {
    const previewHost = dragPreviewHostEl;
    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    const sourceRow = tableEditorEl?.querySelector<HTMLTableRowElement>(
      `[data-table-row-container="${rowIndex}"]`
    );
    const sourceTable = sourceRow?.closest<HTMLTableElement>('table');
    if (!previewHost || !scrollRegion || !sourceRow || !sourceTable) return null;

    const rowRect = sourceRow.getBoundingClientRect();
    const tableRect = sourceTable.getBoundingClientRect();
    const scrollRect = scrollRegion.getBoundingClientRect();
    const clipLeft = Math.max(rowRect.left, scrollRect.left);
    const clipRight = Math.min(rowRect.right, scrollRect.right);
    if (clipRight <= clipLeft) return null;

    const preview = globalThis.document.createElement('div');
    preview.className = 'table-drag-preview row-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.style.left = `${clipLeft}px`;
    preview.style.top = `${rowRect.top}px`;
    preview.style.width = `${clipRight - clipLeft}px`;
    preview.style.height = `${rowRect.height}px`;

    const previewTable = sourceTable.cloneNode(false) as HTMLTableElement;
    previewTable.classList.add('drag-preview-table');
    previewTable.style.position = 'absolute';
    previewTable.style.top = '0';
    previewTable.style.left = `${tableRect.left - clipLeft}px`;
    previewTable.style.width = `${tableRect.width}px`;
    const colgroup = sourceTable.querySelector('colgroup')?.cloneNode(true);
    if (colgroup) previewTable.append(colgroup);

    const previewSection = sourceRow.parentElement?.cloneNode(false) as HTMLElement | null;
    if (!previewSection) return null;
    const previewRow = sourceRow.cloneNode(true) as HTMLTableRowElement;
    previewRow.classList.remove('table-drag-source');
    previewRow.style.height = `${rowRect.height}px`;
    syncDragPreviewFormValues(sourceRow, previewRow);
    previewSection.append(previewRow);
    previewTable.append(previewSection);
    preview.append(previewTable);
    previewHost.append(preview);
    sourceRow.classList.add('table-drag-source');

    return createDragPreviewController(
      preview,
      [sourceRow],
      'row',
      startClientX,
      startClientY
    );
  }

  function createColumnDragPreview(
    columnIndex: number,
    startClientX: number,
    startClientY: number
  ): DragPreviewController | null {
    const previewHost = dragPreviewHostEl;
    const scrollRegion = tableEditorEl?.querySelector<HTMLElement>('.table-scroll-region');
    const sourceHeader = tableEditorEl?.querySelector<HTMLElement>(
      `th[data-table-column-container="${columnIndex}"]`
    );
    if (!previewHost || !scrollRegion || !sourceHeader) return null;

    const headerRect = sourceHeader.getBoundingClientRect();
    const scrollRect = scrollRegion.getBoundingClientRect();
    const clipLeft = Math.max(headerRect.left, scrollRect.left);
    const clipRight = Math.min(headerRect.right, scrollRect.right);
    const clipTop = Math.max(headerRect.top, scrollRect.top);
    const clipBottom = scrollRect.bottom;
    if (clipRight <= clipLeft || clipBottom <= clipTop) return null;

    const preview = globalThis.document.createElement('div');
    preview.className = 'table-drag-preview column-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.style.left = `${clipLeft}px`;
    preview.style.top = `${clipTop}px`;
    preview.style.width = `${clipRight - clipLeft}px`;
    preview.style.height = `${clipBottom - clipTop}px`;

    const sourceElements = getVisibleColumnElements(columnIndex);
    for (const sourceCell of sourceElements) {
      const cellRect = sourceCell.getBoundingClientRect();
      const previewCell = sourceCell.cloneNode(true) as HTMLElement;
      previewCell.classList.remove('table-drag-source', 'table-reorder-source', 'table-reorder-shift');
      previewCell.classList.add('column-drag-preview-cell');
      previewCell.style.left = `${cellRect.left - clipLeft}px`;
      previewCell.style.top = `${cellRect.top - clipTop}px`;
      previewCell.style.width = `${cellRect.width}px`;
      previewCell.style.height = `${cellRect.height}px`;
      syncDragPreviewFormValues(sourceCell, previewCell);
      preview.append(previewCell);
    }

    if (sourceElements.length === 0) return null;
    previewHost.append(preview);
    sourceElements.forEach((element) => element.classList.add('table-drag-source'));

    return createDragPreviewController(
      preview,
      sourceElements,
      'column',
      startClientX,
      startClientY
    );
  }

  function startRowPointerDrag(event: PointerEvent, rowIndex: number) {
    if (
      !editable
      || event.button !== 0
      || !event.isPrimary
      || draggedRow !== null
      || draggedColumn !== null
    ) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLElement;
    const pointerEventTarget = globalThis.window;
    const pointerId = event.pointerId;
    draggedRow = rowIndex;
    setRowDropBoundary(getRowDropBoundaryAtPoint(event.clientX, event.clientY) ?? rowIndex);
    selectedRow = rowIndex;
    handle.setPointerCapture(pointerId);
    const dragPreview = createRowDragPreview(rowIndex, event.clientX, event.clientY);

    const updateTarget = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      dragPreview?.update(moveEvent.clientX, moveEvent.clientY);
      const dropBoundary = getRowDropBoundaryAtPoint(moveEvent.clientX, moveEvent.clientY);
      if (dropBoundary !== null) {
        setRowDropBoundary(dropBoundary);
      }
    };

    const stopPointerTracking = () => {
      pointerEventTarget.removeEventListener('pointermove', updateTarget, true);
      pointerEventTarget.removeEventListener('pointerup', finishDrag, true);
      pointerEventTarget.removeEventListener('pointercancel', cancelDrag, true);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };

    const cleanup = () => {
      stopPointerTracking();
      dragPreview?.destroy();
      clearDragState();
    };

    const finishDrag = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      const dropBoundary = getRowDropBoundaryAtPoint(finishEvent.clientX, finishEvent.clientY)
        ?? rowDropBoundary;
      const targetIndex = dropBoundary === null
        ? rowIndex
        : getMoveTargetIndex(rowIndex, dropBoundary, document.rows.length);
      if (targetIndex === rowIndex) {
        cleanup();
        return;
      }

      stopPointerTracking();
      const sourceRow = tableEditorEl?.querySelector<HTMLElement>(
        `[data-table-row-container="${rowIndex}"]`
      );
      const targetRow = tableEditorEl?.querySelector<HTMLElement>(
        `[data-table-row-container="${targetIndex}"]`
      );
      const sourceRect = sourceRow?.getBoundingClientRect();
      const targetRect = targetRow?.getBoundingClientRect();
      const reorderAnimation = sourceRect && targetRect && dragPreview
        ? createReorderAnimationController('row', rowIndex, document.rows.length)
        : null;

      const commitMove = () => {
        flushSync(() => {
          ondocumentchange(moveDelimitedTableRow(document, rowIndex, targetIndex));
          selectedRow = targetIndex;
        });
        reorderAnimation?.destroy();
        dragPreview?.destroy();
        clearDragState();
        focusRowHandle(targetIndex);
      };

      if (!reorderAnimation || !sourceRect || !targetRect || !dragPreview) {
        commitMove();
        return;
      }

      reorderAnimation.update(targetIndex);
      playReorderAnimation(
        dragPreview,
        reorderAnimation,
        0,
        targetRect.top - sourceRect.top,
        commitMove
      );
    };

    const cancelDrag = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };

    pointerEventTarget.addEventListener('pointermove', updateTarget, true);
    pointerEventTarget.addEventListener('pointerup', finishDrag, true);
    pointerEventTarget.addEventListener('pointercancel', cancelDrag, true);
  }

  function startColumnPointerDrag(event: PointerEvent, columnIndex: number) {
    if (
      !editable
      || event.button !== 0
      || !event.isPrimary
      || draggedRow !== null
      || draggedColumn !== null
    ) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLElement;
    const pointerEventTarget = globalThis.window;
    const pointerId = event.pointerId;
    draggedColumn = columnIndex;
    setColumnDropBoundary(getColumnDropBoundaryAtPoint(event.clientX, event.clientY) ?? columnIndex);
    selectedColumn = columnIndex;
    handle.setPointerCapture(pointerId);
    const dragPreview = createColumnDragPreview(columnIndex, event.clientX, event.clientY);

    const updateTarget = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      dragPreview?.update(moveEvent.clientX, moveEvent.clientY);
      const dropBoundary = getColumnDropBoundaryAtPoint(moveEvent.clientX, moveEvent.clientY);
      if (dropBoundary !== null) {
        setColumnDropBoundary(dropBoundary);
      }
    };

    const stopPointerTracking = () => {
      pointerEventTarget.removeEventListener('pointermove', updateTarget, true);
      pointerEventTarget.removeEventListener('pointerup', finishDrag, true);
      pointerEventTarget.removeEventListener('pointercancel', cancelDrag, true);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };

    const cleanup = () => {
      stopPointerTracking();
      dragPreview?.destroy();
      clearDragState();
    };

    const finishDrag = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      const dropBoundary = getColumnDropBoundaryAtPoint(finishEvent.clientX, finishEvent.clientY)
        ?? columnDropBoundary;
      const targetIndex = dropBoundary === null
        ? columnIndex
        : getMoveTargetIndex(columnIndex, dropBoundary, columnCount);
      if (targetIndex === columnIndex) {
        cleanup();
        return;
      }

      stopPointerTracking();
      const sourceColumn = tableEditorEl?.querySelector<HTMLElement>(
        `th[data-table-column-container="${columnIndex}"]`
      );
      const targetColumn = tableEditorEl?.querySelector<HTMLElement>(
        `th[data-table-column-container="${targetIndex}"]`
      );
      const sourceRect = sourceColumn?.getBoundingClientRect();
      const targetRect = targetColumn?.getBoundingClientRect();
      const reorderAnimation = sourceRect && targetRect && dragPreview
        ? createReorderAnimationController('column', columnIndex, columnCount)
        : null;

      const commitMove = () => {
        flushSync(() => {
          moveColumnWidth(columnIndex, targetIndex);
          ondocumentchange(moveDelimitedTableColumn(document, columnIndex, targetIndex));
          selectedColumn = targetIndex;
        });
        reorderAnimation?.destroy();
        dragPreview?.destroy();
        clearDragState();
        focusColumnHandle(targetIndex);
      };

      if (!reorderAnimation || !sourceRect || !targetRect || !dragPreview) {
        commitMove();
        return;
      }

      reorderAnimation.update(targetIndex);
      playReorderAnimation(
        dragPreview,
        reorderAnimation,
        targetRect.left - sourceRect.left,
        0,
        commitMove
      );
    };

    const cancelDrag = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };

    pointerEventTarget.addEventListener('pointermove', updateTarget, true);
    pointerEventTarget.addEventListener('pointerup', finishDrag, true);
    pointerEventTarget.addEventListener('pointercancel', cancelDrag, true);
  }

  function handleRowHandleKeydown(event: KeyboardEvent, rowIndex: number) {
    if (!editable || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const targetIndex = rowIndex + (event.key === 'ArrowUp' ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= document.rows.length) return;
    ondocumentchange(moveDelimitedTableRow(document, rowIndex, targetIndex));
    selectedRow = targetIndex;
    focusRowHandle(targetIndex);
  }

  function handleColumnHandleKeydown(event: KeyboardEvent, columnIndex: number) {
    if (!editable || !event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const targetIndex = columnIndex + (event.key === 'ArrowLeft' ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= columnCount) return;
    moveColumnWidth(columnIndex, targetIndex);
    ondocumentchange(moveDelimitedTableColumn(document, columnIndex, targetIndex));
    selectedColumn = targetIndex;
    focusColumnHandle(targetIndex);
  }

  function startColumnResize(event: PointerEvent, columnIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = getColumnWidth(columnIndex);
    resizingColumn = columnIndex;
    handle.setPointerCapture(pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setColumnWidth(columnIndex, startWidth + moveEvent.clientX - startX);
    };

    const finishResize = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', handlePointerMove);
      handle.removeEventListener('pointerup', finishResize);
      handle.removeEventListener('pointercancel', finishResize);
      resizingColumn = null;
    };

    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
  }

  function fitColumnToContent(columnIndex: number) {
    const canvas = globalThis.document.createElement('canvas');
    const context = canvas.getContext('2d');
    const sampleCell = tableEditorEl?.querySelector<HTMLTextAreaElement>('.table-cell-editor');
    if (context && sampleCell) {
      const cellStyle = getComputedStyle(sampleCell);
      context.font = cellStyle.font || `${cellStyle.fontSize} ${cellStyle.fontFamily}`;
    }

    let widestContent = 0;
    for (const row of document.rows) {
      const value = row[columnIndex] ?? '';
      for (const line of value.split(/\r\n|\r|\n/u)) {
        const measuredWidth = context ? context.measureText(line).width : line.length * 7.5;
        widestContent = Math.max(widestContent, measuredWidth);
      }
    }

    setColumnWidth(columnIndex, Math.max(48, widestContent + 22));
  }

  function handleColumnResizeDoubleClick(event: MouseEvent, columnIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    fitColumnToContent(columnIndex);
  }

  function handleColumnResizeKeydown(event: KeyboardEvent, columnIndex: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      fitColumnToContent(columnIndex);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setColumnWidth(columnIndex, getColumnWidth(columnIndex) + direction * (event.shiftKey ? 32 : 8));
  }
</script>

{#snippet rowControlCell(rowIndex: number, isHeader = false)}
  <th class="row-control" class:table-corner={isHeader} scope="row">
    <span
      class="row-drag-handle"
      class:dragging-handle={draggedRow === rowIndex}
      role="button"
      tabindex={editable ? 0 : -1}
      aria-label={t('table.moveRow', { row: rowIndex + 1 })}
      title={t('table.moveRowHint', { row: rowIndex + 1 })}
      onpointerdown={(event) => startRowPointerDrag(event, rowIndex)}
      onkeydown={(event) => handleRowHandleKeydown(event, rowIndex)}
      onfocus={() => selectedRow = rowIndex}
    >
      <GripVertical size={12} aria-hidden="true" />
    </span>
    {#if showRowIndices}<span class="row-index">{rowIndex + 1}</span>{/if}
    {#if editable}
      <span class="edge-remove-zone row-remove-zone">
        <button
          class="edge-action-button edge-remove-button"
          type="button"
          aria-label={t('table.removeRow', { row: rowIndex + 1 })}
          title={t('table.removeRow', { row: rowIndex + 1 })}
          onpointerdown={stopEdgeActionPointer}
          onclick={(event) => {
            event.stopPropagation();
            removeRowAt(rowIndex);
          }}
        >
          <Minus size={12} aria-hidden="true" />
        </button>
      </span>
      <span class="edge-insert-zone row-insert-zone row-insert-before">
        <button
          class="edge-action-button edge-insert-button"
          type="button"
          aria-label={t('table.addRowBefore', { row: rowIndex + 1 })}
          title={t('table.addRowBefore', { row: rowIndex + 1 })}
          onpointerdown={stopEdgeActionPointer}
          onclick={(event) => {
            event.stopPropagation();
            addRowAt(rowIndex);
          }}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </span>
      {#if rowIndex === document.rows.length - 1}
        <span class="edge-insert-zone row-insert-zone row-insert-after">
          <button
            class="edge-action-button edge-insert-button"
            type="button"
            aria-label={t('table.addRowAfter', { row: rowIndex + 1 })}
            title={t('table.addRowAfter', { row: rowIndex + 1 })}
            onpointerdown={stopEdgeActionPointer}
            onclick={(event) => {
              event.stopPropagation();
              addRowAt(rowIndex + 1);
            }}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        </span>
      {/if}
    {/if}
  </th>
{/snippet}

{#snippet cellEditor(row: string[], rowIndex: number, columnIndex: number, isHeader = false)}
  <textarea
    class="table-cell-editor"
    class:header-cell-editor={isHeader}
    class:selected-cell={selectedRow === rowIndex && selectedColumn === columnIndex}
    data-table-row={rowIndex}
    data-table-column={columnIndex}
    value={row[columnIndex] ?? ''}
    dir="auto"
    rows={Math.min(4, Math.max(1, (row[columnIndex] ?? '').split(/\r\n|\r|\n/u).length))}
    readonly={!editable}
    aria-label={isHeader
      ? t('table.headerCell', { column: getColumnName(columnIndex) })
      : t('table.cell', { row: rowIndex + 1, column: getColumnName(columnIndex) })}
    spellcheck="false"
    onfocus={() => selectCell(rowIndex, columnIndex)}
    onpointerdown={() => selectCell(rowIndex, columnIndex)}
    oninput={(event) => handleCellInput(event, rowIndex, columnIndex)}
    onkeydown={(event) => handleCellKeydown(event, rowIndex, columnIndex)}
  ></textarea>
{/snippet}

<div class="table-editor" bind:this={tableEditorEl}>
  <div class="table-toolbar" role="toolbar" aria-label={t('table.toolbar', { format: formatLabel })}>
    <div class="table-summary">
      <span class="format-badge">{formatLabel}</span>
      <span>{t('table.dimensions', { rows: document.rows.length, columns: columnCount })}</span>
    </div>

    <div class="toolbar-spacer"></div>

    <button
      class="compact-tool toggle-tool"
      class:active={highlightHeader}
      type="button"
      aria-pressed={highlightHeader}
      onclick={() => onhighlightheaderchange(!highlightHeader)}
      title={t('table.toggleHeader')}
    >
      {t('table.firstRow')}
    </button>
    <button
      class="compact-tool toggle-tool"
      class:active={showRowIndices}
      type="button"
      aria-pressed={showRowIndices}
      onclick={() => onshowrowindiceschange(!showRowIndices)}
      title={t('table.toggleRowNumbers')}
    >
      {t('table.rowNumbers')}
    </button>
  </div>

  {#if !editable}
    <div class="table-readonly-note">{t('table.readonly')}</div>
  {/if}

  <div class="table-scroll-region">
    <table class="data-table" style={`width: ${tablePixelWidth}px`}>
      <colgroup>
        <col class="row-control-column" />
        {#each Array(columnCount) as _, columnIndex}
          <col style={`width: ${getColumnWidth(columnIndex)}px`} />
        {/each}
      </colgroup>
      <thead>
        <tr
          class="column-control-row"
          class:header-data-row={highlightHeader}
          class:selected-row={selectedRow === 0}
          data-table-row-container={0}
        >
          {@render rowControlCell(0, true)}
          {#each Array(columnCount) as _, columnIndex}
            <th
              class="column-control"
              class:selected-column={selectedColumn === columnIndex}
              class:resizing-column={resizingColumn === columnIndex}
              data-table-column-container={columnIndex}
              scope="col"
            >
              <span
                class="column-drag-handle"
                class:dragging-handle={draggedColumn === columnIndex}
                role="button"
                tabindex={editable ? 0 : -1}
                aria-label={t('table.moveColumn', { column: getColumnName(columnIndex) })}
                title={t('table.moveColumnHint', { column: getColumnName(columnIndex) })}
                onpointerdown={(event) => startColumnPointerDrag(event, columnIndex)}
                onkeydown={(event) => handleColumnHandleKeydown(event, columnIndex)}
                onfocus={() => selectedColumn = columnIndex}
              >
                <GripHorizontal size={12} aria-hidden="true" />
              </span>
              {@render cellEditor(document.rows[0] ?? [], 0, columnIndex, true)}
              <button
                class="column-resize-handle"
                type="button"
                aria-label={t('table.resizeColumn', { column: getColumnName(columnIndex), width: getColumnWidth(columnIndex) })}
                title={t('table.resizeColumnHint', { column: getColumnName(columnIndex) })}
                onpointerdown={(event) => startColumnResize(event, columnIndex)}
                ondblclick={(event) => handleColumnResizeDoubleClick(event, columnIndex)}
                onkeydown={(event) => handleColumnResizeKeydown(event, columnIndex)}
              ></button>
              {#if editable}
                <span class="edge-remove-zone column-remove-zone">
                  <button
                    class="edge-action-button edge-remove-button"
                    type="button"
                    aria-label={t('table.removeColumn', { column: getColumnName(columnIndex) })}
                    title={t('table.removeColumn', { column: getColumnName(columnIndex) })}
                    onpointerdown={stopEdgeActionPointer}
                    onclick={(event) => {
                      event.stopPropagation();
                      removeColumnAt(columnIndex);
                    }}
                  >
                    <Minus size={12} aria-hidden="true" />
                  </button>
                </span>
                <span class="edge-insert-zone column-insert-zone column-insert-before">
                  <button
                    class="edge-action-button edge-insert-button"
                    type="button"
                    aria-label={t('table.addColumnBefore', { column: getColumnName(columnIndex) })}
                    title={t('table.addColumnBefore', { column: getColumnName(columnIndex) })}
                    onpointerdown={stopEdgeActionPointer}
                    onclick={(event) => {
                      event.stopPropagation();
                      addColumnAt(columnIndex);
                    }}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                </span>
                {#if columnIndex === columnCount - 1}
                  <span class="edge-insert-zone column-insert-zone column-insert-after">
                    <button
                      class="edge-action-button edge-insert-button"
                      type="button"
                      aria-label={t('table.addColumnAfter', { column: getColumnName(columnIndex) })}
                      title={t('table.addColumnAfter', { column: getColumnName(columnIndex) })}
                      onpointerdown={stopEdgeActionPointer}
                      onclick={(event) => {
                        event.stopPropagation();
                        addColumnAt(columnIndex + 1);
                      }}
                    >
                      <Plus size={12} aria-hidden="true" />
                    </button>
                  </span>
                {/if}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each document.rows.slice(1) as row, bodyRowIndex}
          {@const rowIndex = bodyRowIndex + 1}
          <tr
            class:selected-row={selectedRow === rowIndex}
            data-table-row-container={rowIndex}
          >
            {@render rowControlCell(rowIndex)}
            {#each Array(columnCount) as _, columnIndex}
              <td
                class:selected-column={selectedColumn === columnIndex}
                data-table-column-container={columnIndex}
              >
                {@render cellEditor(row, rowIndex, columnIndex)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="drag-preview-layer" bind:this={dragPreviewHostEl} aria-hidden="true"></div>
</div>

<style>
  .table-editor {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    color: var(--text-color);
    background: var(--color-render-bg, var(--bg-editor));
    font-family: var(--font-ui);
  }

  .table-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 4px 8px;
    box-sizing: border-box;
    background: var(--bg-window);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .table-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: max-content;
    color: var(--text-muted);
    font-size: 11px;
  }

  .format-badge {
    padding: 2px 5px;
    border-radius: 3px;
    background: var(--color-hl-code-bg);
    color: var(--color-hl-code-text);
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .toolbar-spacer {
    flex: 1;
  }

  .compact-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-height: 25px;
    padding: 2px 7px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text-color);
    font-family: var(--font-ui);
    font-size: 11px;
    white-space: nowrap;
    cursor: default;
  }

  .compact-tool:hover:not(:disabled) {
    background: var(--bg-menu-hover);
  }

  .compact-tool:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: 1px;
  }

  .compact-tool:disabled {
    opacity: 0.42;
  }

  .toggle-tool {
    color: var(--text-muted);
  }

  .toggle-tool.active {
    color: var(--text-color);
    background: var(--bg-menu-active);
    border-color: var(--border-color);
  }

  .table-readonly-note {
    padding: 4px 10px;
    color: var(--text-muted);
    background: var(--bg-tab-strip);
    border-bottom: 1px solid var(--border-color);
    font-size: 11px;
  }

  .table-scroll-region {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 32px 8px 8px 32px;
    box-sizing: border-box;
  }

  .drag-preview-layer {
    position: fixed;
    z-index: 1000;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .drag-preview-layer :global(.table-drag-preview) {
    position: fixed;
    z-index: 3;
    overflow: hidden;
    contain: layout paint style;
    pointer-events: none;
    will-change: transform;
  }

  .drag-preview-layer :global(.table-drop-indicator) {
    position: fixed;
    z-index: 2;
    border-radius: 2px;
    background: var(--accent-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color) 28%, transparent),
      0 0 5px color-mix(in srgb, var(--accent-color) 45%, transparent);
    pointer-events: none;
  }

  .drag-preview-layer :global(.table-drop-indicator::before) {
    position: absolute;
    width: 6px;
    height: 6px;
    box-sizing: border-box;
    border: 2px solid var(--accent-color);
    border-radius: 50%;
    background: var(--color-render-bg, var(--bg-editor));
    content: '';
  }

  .drag-preview-layer :global(.row-drop-indicator) {
    height: 2px;
    transform: translateY(-1px);
  }

  .drag-preview-layer :global(.row-drop-indicator::before) {
    top: 50%;
    left: -3px;
    transform: translateY(-50%);
  }

  .drag-preview-layer :global(.column-drop-indicator) {
    width: 2px;
    transform: translateX(-1px);
  }

  .drag-preview-layer :global(.column-drop-indicator::before) {
    top: -3px;
    left: 50%;
    transform: translateX(-50%);
  }

  .drag-preview-layer :global(.row-drag-preview),
  .drag-preview-layer :global(.column-drag-preview) {
    background: var(--color-render-bg, var(--bg-editor));
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24);
    outline: 1px solid color-mix(in srgb, var(--accent-color) 78%, transparent);
    opacity: 0.94;
  }

  .drag-preview-layer :global(.drag-preview-table) {
    margin: 0;
  }

  .drag-preview-layer :global(.column-drag-preview-cell) {
    position: absolute !important;
    display: block;
    overflow: hidden !important;
    box-sizing: border-box;
    margin: 0;
  }

  .data-table :global(.table-drag-source) {
    opacity: 0.28;
  }

  .data-table :global(.table-reorder-shift) {
    position: relative;
    z-index: 1;
    will-change: transform;
  }

  .data-table :global(.table-reorder-source) {
    opacity: 0 !important;
  }

  .data-table {
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-family: var(--font-render-family, var(--font-notepad));
    font-size: 12px;
  }

  .row-control-column {
    width: 43px;
  }

  .data-table th,
  .data-table td {
    border-right: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    padding: 0;
    background: var(--color-render-bg, var(--bg-editor));
  }

  .data-table tbody tr {
    content-visibility: auto;
    contain-intrinsic-size: 30px;
  }

  .column-control-row th {
    border-top: 1px solid var(--border-color);
  }

  .table-corner,
  .row-control {
    width: 43px;
    min-width: 43px;
    max-width: 43px;
    border-left: 1px solid var(--border-color);
    background: var(--bg-window) !important;
  }

  .table-corner {
    height: 24px;
    border-top-left-radius: 4px;
  }

  .column-control {
    position: relative;
    height: 30px;
    color: var(--text-muted);
    background: var(--bg-window) !important;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    user-select: none;
    overflow: visible;
  }

  .column-drag-handle {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 22px;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .column-drag-handle > :global(svg) {
    opacity: 0.55;
  }

  .column-resize-handle {
    position: absolute;
    z-index: 16;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }

  .column-resize-handle::after {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: 1px;
    background: transparent;
    content: '';
  }

  .column-resize-handle:hover::after,
  .column-resize-handle:focus-visible::after,
  .resizing-column .column-resize-handle::after {
    width: 2px;
    background: var(--accent-color);
  }

  .column-resize-handle:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: -1px;
  }

  .column-drag-handle:focus-visible,
  .row-drag-handle:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: -2px;
  }

  .row-drag-handle {
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 18px;
    min-height: 30px;
    padding: 0 2px;
    box-sizing: border-box;
    color: var(--text-muted);
    cursor: grab;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 500;
    touch-action: none;
    user-select: none;
  }

  .dragging-handle {
    cursor: grabbing;
  }

  .row-control {
    position: relative;
    overflow: visible;
  }

  .column-control:hover,
  .column-control:focus-within,
  .row-control:hover,
  .row-control:focus-within {
    z-index: 12;
  }

  .edge-insert-zone,
  .edge-remove-zone {
    position: absolute;
    z-index: 14;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
  }

  .edge-action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-dropdown);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
    color: var(--text-muted);
    cursor: default;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.82);
    transition: opacity 80ms ease, transform 80ms ease, background-color 80ms ease;
  }

  .edge-insert-zone:hover .edge-action-button,
  .edge-insert-zone:focus-within .edge-action-button,
  .edge-remove-zone:hover .edge-action-button,
  .edge-remove-zone:focus-within .edge-action-button,
  .edge-action-button:focus-visible {
    opacity: 1;
    pointer-events: auto;
    transform: scale(1);
  }

  .edge-action-button:hover {
    background: var(--bg-menu-hover);
  }

  .edge-action-button:focus-visible {
    outline: 1px solid var(--accent-color);
    outline-offset: 1px;
  }

  .edge-insert-button {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .edge-remove-button {
    color: #c42b1c;
  }

  .column-remove-zone {
    top: -27px;
    left: 50%;
    width: max(18px, 50%);
    height: 24px;
    transform: translateX(-50%);
  }

  .column-insert-zone {
    top: -27px;
    width: 18px;
    height: 24px;
  }

  .column-insert-before {
    left: -9px;
  }

  .column-insert-after {
    right: -9px;
  }

  .row-remove-zone {
    top: 50%;
    left: -27px;
    width: 24px;
    height: max(18px, 50%);
    transform: translateY(-50%);
  }

  .row-insert-zone {
    left: -27px;
    width: 24px;
    height: 18px;
  }

  .row-insert-before {
    top: -9px;
  }

  .row-insert-after {
    bottom: -9px;
  }

  .row-drag-handle > :global(svg) {
    flex-shrink: 0;
    opacity: 0.55;
  }

  .row-index {
    display: block;
    width: 100%;
    padding: 0 5px 0 16px;
    box-sizing: border-box;
    text-align: center;
    pointer-events: none;
  }

  .data-table td {
    vertical-align: top;
  }

  .table-cell-editor {
    display: block;
    width: 100%;
    min-height: 30px;
    max-height: 92px;
    padding: 6px 8px;
    box-sizing: border-box;
    border: 0;
    outline: 0;
    resize: none;
    overflow: auto;
    background: transparent;
    color: var(--color-render-text, var(--text-color));
    font: inherit;
    line-height: 17px;
    white-space: pre-wrap;
  }

  .header-cell-editor {
    padding-left: 24px;
    color: var(--color-render-text, var(--text-color));
    font-family: var(--font-render-family, var(--font-notepad));
    font-size: 12px;
    font-weight: 600;
    cursor: text;
    user-select: text;
  }

  .table-cell-editor:focus,
  .table-cell-editor.selected-cell {
    box-shadow: inset 0 0 0 1px var(--accent-color);
    background: var(--bg-tab-hover);
  }

  .header-data-row .column-control,
  .header-data-row .row-control {
    background: var(--color-hl-code-bg) !important;
  }

  .header-data-row .table-cell-editor {
    color: var(--color-hl-code-text);
    font-weight: 650;
  }

  .selected-row .row-control,
  .selected-column {
    background: var(--bg-menu-active) !important;
  }

  @media (max-width: 640px) {
    .table-toolbar {
      gap: 3px;
      padding-inline: 5px;
    }

    .table-summary > span:last-child {
      display: none;
    }

    .compact-tool {
      padding-inline: 5px;
    }
  }
</style>
