export interface TabDragMetadata {
  transferId: string;
  sourceWindowLabel: string;
}

export interface TabDropRect {
  left: number;
  width: number;
}

export interface TabDockBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface TabDragPreviewPosition {
  left: number;
  top: number;
  visible: boolean;
}
// 다른 편집기 창이 드롭을 수신해 소유권을 요청할 수 있는 짧은 경쟁 구간이다.
// 창 생성 자체를 늦추는 시간이므로 로컬 Tauri 이벤트 왕복보다 충분히 길게만 유지한다.
export const tabDetachTargetClaimDelayMs = 50;



export function isPointInsideTabDock(
  pointerX: number,
  pointerY: number,
  bounds: TabDockBounds
): boolean {
  return pointerX >= bounds.left
    && pointerX <= bounds.right
    && pointerY >= bounds.top
    && pointerY <= bounds.bottom;
}

export function getTabDragPreviewPosition(
  pointerX: number,
  pointerY: number,
  pointerOffsetX: number,
  pointerOffsetY: number,
  viewportWidth: number,
  viewportHeight: number
): TabDragPreviewPosition {
  return {
    left: pointerX - pointerOffsetX,
    top: pointerY - pointerOffsetY,
    visible: pointerX >= 0
      && pointerX <= viewportWidth
      && pointerY >= 0
      && pointerY <= viewportHeight
  };
}


export function getTabDropIndex(pointerX: number, tabRects: TabDropRect[]): number {
  const nextIndex = tabRects.findIndex((rect) => pointerX < rect.left + (rect.width / 2));
  return nextIndex === -1 ? tabRects.length : nextIndex;
}

export function normalizeTabReorderIndex(
  sourceIndex: number,
  dropIndex: number,
  tabCount: number
): number {
  const boundedDropIndex = Math.max(0, Math.min(dropIndex, tabCount));
  const adjustedIndex = boundedDropIndex > sourceIndex
    ? boundedDropIndex - 1
    : boundedDropIndex;
  return Math.max(0, Math.min(adjustedIndex, Math.max(0, tabCount - 1)));
}

export function reorderTabItems<T>(items: T[], sourceIndex: number, dropIndex: number): T[] {
  if (sourceIndex < 0 || sourceIndex >= items.length) return [...items];

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(sourceIndex, 1);
  const targetIndex = normalizeTabReorderIndex(sourceIndex, dropIndex, items.length);
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems;
}

export function insertTabItem<T>(items: T[], item: T, dropIndex: number): T[] {
  const nextItems = [...items];
  const targetIndex = Math.max(0, Math.min(dropIndex, nextItems.length));
  nextItems.splice(targetIndex, 0, item);
  return nextItems;
}
