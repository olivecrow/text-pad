/** 원문 위치로 저장하는 선택. anchor는 기준점, head는 움직이는 끝점이다. */
export interface CaretRange { anchor: number; head: number }

/** 정렬된 범위를 쓰는 입력·기록 어댑터. 생략한 방향은 정방향이다. */
export interface EditorSelection {
  start: number;
  end: number;
  direction?: 'forward' | 'backward';
}

export function caretSelection(range: CaretRange): EditorSelection {
  return {
    start: Math.min(range.anchor, range.head), end: Math.max(range.anchor, range.head),
    ...(range.head < range.anchor ? { direction: 'backward' as const } : {})
  };
}

export function selectionCaret(selection: EditorSelection): CaretRange {
  return selection.direction === 'backward'
    ? { anchor: selection.end, head: selection.start }
    : { anchor: selection.start, head: selection.end };
}
