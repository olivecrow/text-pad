export interface CaretGeometry {
  rectAt(offset: number): DOMRect | null;
  offsetAt(x: number, y: number): number | null;
  dispose(): void;
}

/** 단일·다중 캐럿이 공유하는 표시 행 탐색. 고정 줄 높이만큼 이동했다고 가정하지 않는다. */
export function adjacentVisualRow(geometry: CaretGeometry, offset: number, x: number, direction: -1 | 1,
  safe: (offset: number, direction: -1 | 1) => number | null, limit: number): number | null {
  const rect = geometry.rectAt(offset);
  if (!rect) return null;
  // 작은 글자가 섞인 행도 건너뛰지 않도록 현재 글자 높이보다 촘촘하게 탐색한다.
  const step = Math.max(1, Math.min(4, rect.height / 4));
  for (let distance = 1; distance <= limit; distance += step) {
    const raw = geometry.offsetAt(x, direction < 0 ? rect.top - distance : rect.bottom + distance);
    if (raw === null) continue;
    const target = safe(raw, direction);
    if (target === null) continue;
    const next = geometry.rectAt(target);
    if (next && (direction < 0 ? next.bottom <= rect.top + 0.5 : next.top >= rect.bottom - 0.5)) return target;
  }
  return null;
}
