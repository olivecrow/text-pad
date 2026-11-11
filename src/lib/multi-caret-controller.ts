import type { EditorSelection, EditorSnapshot } from './editor-undo';
import { getPreferredNewline } from './editor-input';
import { adjacentTextOffset, caretSelection, cloneMultiCaret,
  replaceAtCarets, splitCaretPaste, type CaretRange, type CaretReplacement, type MultiCaretSelection } from './multi-caret';

export interface CaretGeometry {
  rectAt(offset: number): DOMRect | null;
  offsetAt(x: number, y: number): number | null;
  dispose(): void;
}

interface MultiCaretHost {
  input(): HTMLTextAreaElement | null;
  scroller(): HTMLElement | null;
  read(): EditorSnapshot;
  select(value: MultiCaretSelection): void;
  apply(before: EditorSnapshot, after: EditorSnapshot, mergeKey: string | null): void;
  geometry(): CaretGeometry | null;
  safe(offset: number, direction: -1 | 0 | 1): number | null;
  replacement(selection: EditorSelection, text: string): CaretReplacement | null;
  deletion(range: CaretRange, direction: -1 | 1, word: boolean): EditorSelection | null;
  closeGroup(): void;
  lineHeight(): number;
  tabText(): string;
  enabled(): boolean;
}

export class MultiCaretController {
  private addColumn: number | null = null;
  private drag: { pointerId: number; offset: number; x: number; y: number; currentX: number;
    rows: CaretRange[]; direction: -1 | 1 } | null = null;
  private scrollFrame: number | null = null;
  private composition: EditorSnapshot | null = null;
  private compositionReplacements: CaretReplacement[] | null = null;

  constructor(private host: MultiCaretHost) {}

  reset() {
    this.stopDrag();
    this.addColumn = null;
    this.composition = null;
    this.compositionReplacements = null;
  }

  clear() {
    const value = this.host.read().multiCaret;
    this.reset();
    if (!value) return;
    const head = value.ranges[value.primary].head;
    this.host.select({ ranges: [{ anchor: head, head }], primary: 0 });
    this.host.closeGroup();
  }

  private current(): MultiCaretSelection {
    const snapshot = this.host.read();
    if (snapshot.multiCaret) return cloneMultiCaret(snapshot.multiCaret)!;
    const { start, end } = snapshot.selection;
    return { ranges: [this.host.input()?.selectionDirection === 'backward'
      ? { anchor: end, head: start } : { anchor: start, head: end }], primary: 0 };
  }

  private vertical(geometry: CaretGeometry, offset: number, x: number, direction: -1 | 1): number | null {
    const rect = geometry.rectAt(offset);
    if (!rect) return null;
    // 문단 여백, 큰 제목과 숨긴 울타리는 실제 다음 표시 줄까지 건너뛴다.
    const limit = Math.max(this.host.scroller()?.clientHeight ?? 0, this.host.lineHeight() * 3);
    for (let distance = 1; distance <= limit; distance += Math.max(1, this.host.lineHeight() / 2)) {
      const raw = geometry.offsetAt(x, direction < 0 ? rect.top - distance : rect.bottom + distance);
      if (raw === null) continue;
      const target = this.host.safe(raw, direction);
      if (target === null) continue;
      const next = geometry.rectAt(target);
      if (next && (direction < 0 ? next.bottom <= rect.top + 0.5 : next.top >= rect.bottom - 0.5)) return target;
      if (direction < 0 ? raw === 0 : raw === this.host.read().content.length) break;
    }
    return null;
  }

  keydown(event: KeyboardEvent): boolean {
    if (event.isComposing || this.composition || !this.host.enabled()) return false;
    const active = this.host.read().multiCaret;
    if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return !!active;
    if (event.key === 'Escape' && active) { event.preventDefault(); this.clear(); return true; }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const geometry = this.host.geometry();
      if (!geometry) return true;
      try {
        const value = this.current();
        const range = value.ranges[value.primary];
        this.addColumn ??= geometry.rectAt(range.head)?.left ?? 0;
        const target = this.vertical(geometry, range.head, this.addColumn, event.key === 'ArrowUp' ? -1 : 1);
        if (target !== null) {
          const oldIndex = value.ranges.findIndex(item => item.head === target);
          if (oldIndex >= 0) value.primary = oldIndex;
          else { value.ranges.push({ anchor: target, head: target }); value.primary = value.ranges.length - 1; }
          this.host.select(value);
          this.host.closeGroup();
        }
      } finally { geometry.dispose(); }
      return true;
    }
    if (!active) { this.addColumn = null; return false; }
    this.addColumn = null;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === 'a') { this.clear(); return false; }
    }
    if (event.altKey) return true;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      this.delete(event.key === 'Backspace' ? -1 : 1, event.ctrlKey || event.metaKey);
      return true;
    }
    if (event.key === 'Tab') { event.preventDefault(); this.insert(this.host.tabText()); return true; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      this.move(event);
    }
    // 일반 입력은 beforeinput에서 처리하므로 단일 캐럿용 렌더 보조 기능을 실행하지 않는다.
    return true;
  }

  private move(event: KeyboardEvent) {
    const before = this.host.read();
    const value = before.multiCaret;
    const geometry = this.host.geometry();
    if (!value || !geometry) return;
    try {
      const direction = ['ArrowLeft', 'ArrowUp', 'Home', 'PageUp'].includes(event.key) ? -1 : 1;
      const viewport = this.host.scroller()?.getBoundingClientRect();
      const ranges = value.ranges.map(range => {
        let head = range.head;
        const rect = geometry.rectAt(head);
        const selection = caretSelection(range);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          head = !event.shiftKey && selection.start !== selection.end
            ? direction < 0 ? selection.start : selection.end
            : adjacentTextOffset(before.content, head, direction, event.ctrlKey || event.metaKey);
          // 목록 접두부 등 도달할 수 없는 표시 구간에서 같은 캐럿으로 되돌아오지 않는다.
          while (head !== range.head && this.host.safe(head, direction) === range.head) {
            const next = adjacentTextOffset(before.content, head, direction, event.ctrlKey || event.metaKey);
            if (next === head) break;
            head = next;
          }
        } else if ((event.ctrlKey || event.metaKey) && ['Home', 'End'].includes(event.key)) {
          head = direction < 0 ? 0 : before.content.length;
        } else if (rect && viewport) {
          if (event.key === 'Home' || event.key === 'End') {
            head = geometry.offsetAt(direction < 0 ? viewport.left : viewport.right, rect.top + rect.height / 2) ?? head;
          } else {
            head = event.key.startsWith('Page')
              ? geometry.offsetAt(rect.left, rect.top + rect.height / 2 + direction * viewport.height) ?? head
              : this.vertical(geometry, head, rect.left, direction)
                ?? geometry.offsetAt(direction < 0 ? viewport.left : viewport.right, rect.top + rect.height / 2) ?? head;
          }
        }
        head = this.host.safe(head, direction) ?? range.head;
        return { anchor: event.shiftKey ? range.anchor : head, head };
      });
      this.host.select({ ranges, primary: value.primary });
      this.host.closeGroup();
    } finally { geometry.dispose(); }
  }

  beforeInput(event: InputEvent): boolean {
    if (!this.host.read().multiCaret || this.composition || event.isComposing) return false;
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault(); this.insert('\n'); return true;
    }
    if (event.inputType.startsWith('insert') && event.data !== null) {
      event.preventDefault(); this.insert(event.data, event.inputType === 'insertText' ? 'multi-insert' : null); return true;
    }
    if (event.inputType.startsWith('delete')) {
      event.preventDefault(); this.delete(event.inputType.endsWith('Backward') ? -1 : 1, event.inputType.includes('Word')); return true;
    }
    return false;
  }

  insert(text: string, mergeKey: string | null = null, distribute = false) {
    const before = this.host.read();
    const value = before.multiCaret;
    if (!value) return false;
    const fragments = distribute ? splitCaretPaste(text, value.ranges.length) : value.ranges.map(() => text);
    const edits = value.ranges.map((range, index) => this.host.replacement(caretSelection(range),
      fragments[index].replace(/\r\n|\r|\n/gu, getPreferredNewline(before.content, range.head))));
    if (edits.some(edit => edit === null)) return true;
    this.commit(before, replaceAtCarets(before.content, value, edits as CaretReplacement[]),
      value.ranges.some(range => range.anchor !== range.head) ? null : mergeKey);
    return true;
  }

  delete(direction: -1 | 1, word = false) {
    const before = this.host.read();
    const value = before.multiCaret;
    if (!value) return false;
    const edits = value.ranges.map(range => {
      const selection = this.host.deletion(range, direction, word);
      return selection && this.host.replacement(selection, '');
    });
    if (edits.some(edit => edit === null)) return true;
    this.commit(before, replaceAtCarets(before.content, value, edits as CaretReplacement[]),
      value.ranges.some(range => range.anchor !== range.head) ? null : `multi-delete-${direction}`);
    return true;
  }

  copyText(): string | null {
    const before = this.host.read();
    const value = before.multiCaret;
    if (!value) return null;
    const selected = value.ranges.some(range => range.anchor !== range.head);
    return value.ranges.map(range => {
      const selection = selected ? caretSelection(range) : this.lineSelection(before.content, range.head);
      return before.content.slice(selection.start, selection.end);
    }).join('\n');
  }

  cut() {
    const before = this.host.read();
    const value = before.multiCaret;
    if (!value) return false;
    if (value.ranges.some(range => range.anchor !== range.head)) {
      const edits = value.ranges.map(range => this.host.replacement(caretSelection(range), ''));
      if (edits.every(edit => edit !== null)) this.commit(before,
        replaceAtCarets(before.content, value, edits as CaretReplacement[]), null);
      return true;
    }
    const edits = value.ranges.map(range => {
      const selection = this.lineSelection(before.content, range.head);
      const next = before.content.indexOf('\n', selection.end);
      return { ...selection, end: next >= 0 ? next + 1 : selection.end, text: '' };
    });
    if (edits.some(edit => this.host.replacement(edit, '') === null)) return true;
    this.commit(before, replaceAtCarets(before.content, value, edits), null);
    return true;
  }

  private lineSelection(content: string, offset: number): EditorSelection {
    const start = offset > 0 ? content.lastIndexOf('\n', offset - 1) + 1 : 0;
    const next = content.indexOf('\n', offset);
    return { start, end: next < 0 ? content.length : next > 0 && content[next - 1] === '\r' ? next - 1 : next };
  }

  private commit(before: EditorSnapshot, after: EditorSnapshot, mergeKey: string | null) {
    this.addColumn = null;
    if (!mergeKey) this.host.closeGroup();
    this.host.apply(before, after, mergeKey);
  }

  startComposition() {
    const before = this.host.read();
    this.composition = before.multiCaret ? { ...before, multiCaret: cloneMultiCaret(before.multiCaret) } : null;
    const edits = before.multiCaret?.ranges.map(range => this.host.replacement(caretSelection(range), ''));
    this.compositionReplacements = edits && edits.every(edit => edit !== null) ? edits as CaretReplacement[] : null;
  }

  compositionSnapshot(after: EditorSnapshot): EditorSnapshot {
    const before = this.composition;
    const value = before?.multiCaret;
    if (!before || !value) return after;
    const delta = after.content.length - before.content.length;
    return { ...after, multiCaret: { primary: value.primary, ranges: value.ranges.map((range, index) => {
      if (index === value.primary) return { anchor: after.selection.start, head: after.selection.end };
      const shift = (offset: number) => offset >= before.selection.end ? offset + delta : offset;
      return { anchor: shift(range.anchor), head: shift(range.head) };
    }) } };
  }

  finishComposition(): boolean {
    const original = this.composition;
    this.composition = null;
    const planned = this.compositionReplacements;
    this.compositionReplacements = null;
    if (!original?.multiCaret) return false;
    const current = this.host.read();
    const insertedLength = current.content.length - original.content.length + original.selection.end - original.selection.start;
    const text = current.content.slice(original.selection.start, original.selection.start + Math.max(0, insertedLength));
    const edits = planned?.map(edit => ({ ...edit, text: text + edit.text, caret: text.length + (edit.caret ?? 0) }));
    const after = edits ? replaceAtCarets(original.content, original.multiCaret, edits) : original;
    this.commit(current, after, 'composition');
    return true;
  }

  pointerDown(event: PointerEvent): boolean {
    if (event.button !== 1 || !this.host.enabled() || this.composition) return false;
    const geometry = this.host.geometry();
    if (!geometry) return false;
    try {
      const raw = geometry.offsetAt(event.clientX, event.clientY);
      const offset = raw === null ? null : this.host.safe(raw, 0);
      if (offset === null) return false;
      event.preventDefault();
      this.drag = { pointerId: event.pointerId, offset, x: event.clientX, y: event.clientY, currentX: event.clientX,
        rows: [{ anchor: offset, head: offset }], direction: 1 };
      this.host.input()?.focus({ preventScroll: true });
      this.host.input()?.setPointerCapture(event.pointerId);
      this.host.select({ ranges: [{ anchor: offset, head: offset }], primary: 0 });
      this.host.closeGroup();
      return true;
    } finally { geometry.dispose(); }
  }

  pointerMove(event: PointerEvent): boolean {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return false;
    this.drag.y = event.clientY;
    this.drag.currentX = event.clientX;
    this.updateDrag();
    return true;
  }

  pointerUp(event: PointerEvent): boolean {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return false;
    this.pointerMove(event);
    this.stopDrag();
    event.preventDefault();
    return true;
  }

  stopDrag() {
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    if (this.drag && this.host.input()?.hasPointerCapture(this.drag.pointerId)) {
      this.host.input()?.releasePointerCapture(this.drag.pointerId);
    }
    this.drag = null;
  }

  private updateDrag() {
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    const drag = this.drag;
    const scroller = this.host.scroller();
    if (!drag || !scroller) return;
    const viewport = scroller.getBoundingClientRect();
    const delta = drag.y < viewport.top ? drag.y - viewport.top : drag.y > viewport.bottom ? drag.y - viewport.bottom : 0;
    if (delta) scroller.scrollTop += Math.sign(delta) * Math.min(30, Math.abs(delta));
    const geometry = this.host.geometry();
    if (!geometry) return;
    try {
      const initial = geometry.rectAt(drag.offset);
      // 가상화로 시작 줄이 화면 밖으로 나가도 이미 지나간 줄의 캐럿은 보존한다.
      const firstVisible = initial ? 0 : drag.rows.findIndex(range => geometry.rectAt(range.anchor) !== null);
      if (firstVisible < 0) return;
      const direction = initial ? (drag.y < initial.top ? -1 : 1) : drag.direction;
      drag.direction = direction;
      const ranges: CaretRange[] = initial ? [] : drag.rows.slice(0, firstVisible);
      let offset = initial ? drag.offset : drag.rows[firstVisible].anchor;
      const seen = new Set<number>();
      while (!seen.has(offset)) {
        seen.add(offset);
        const rect = geometry.rectAt(offset);
        if (!rect) break;
        if (ranges.length && (direction < 0 ? rect.bottom < drag.y : rect.top > drag.y)) break;
        const raw = geometry.offsetAt(drag.currentX, rect.top + rect.height / 2);
        const head = raw === null ? null : this.host.safe(raw, direction);
        ranges.push({ anchor: offset, head: head ?? offset });
        const next = this.vertical(geometry, offset, drag.x, direction);
        if (next === null) break;
        offset = next;
      }
      if (ranges.length) {
        drag.rows = ranges;
        this.host.select({ ranges, primary: ranges.length - 1 });
      }
    } finally { geometry.dispose(); }
    if (delta) this.scrollFrame = requestAnimationFrame(() => this.updateDrag());
  }
}
