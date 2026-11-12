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
    const y = direction < 0 ? rect.top - distance : rect.bottom + distance;
    const raw = geometry.offsetAt(x, y);
    if (raw === null) continue;
    const target = safe(raw, direction);
    if (target === null) continue;
    const next = geometry.rectAt(target);
    if (next && (direction < 0 ? next.bottom <= rect.top + 0.5 : next.top >= rect.bottom - 0.5)) {
      // 행 사이 여백의 판정은 이웃 행을 찾는 데만 사용한다. 가로 위치는 글자 높이의
      // 중앙에서 다시 구해 글꼴별 여백 판정이 첫 글자를 건너뛰지 않도록 한다.
      const centered = geometry.offsetAt(x, next.top + next.height / 2);
      const aligned = centered === null ? null : safe(centered, direction);
      const alignedRect = aligned === null ? null : geometry.rectAt(aligned);
      if (alignedRect && alignedRect.top < next.bottom && alignedRect.bottom > next.top) return aligned;
      // 원문 경계가 두 표시 행에 걸치면 처음 선택한 행의 위치도 복원한다.
      geometry.offsetAt(x, y);
      return target;
    }
  }
  return null;
}
