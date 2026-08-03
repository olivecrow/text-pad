import { getTextChange, type TextChange } from './text-change';

export interface EditorSelection {
  start: number;
  end: number;
}

export interface EditorSnapshot {
  content: string;
  selection: EditorSelection;
}

export interface EditorUndoTransaction {
  rangeStart: number;
  beforeText: string;
  afterText: string;
  beforeSelection: EditorSelection;
  afterSelection: EditorSelection;
  mergeKey: string | null;
  timestamp: number;
}

interface EditorUndoRecordOptions {
  mergeKey?: string | null;
  timestamp?: number;
  mergeWindowMs?: number;
  change?: TextChange | null;
}

export interface EditorUndoHistoryState {
  transactions: EditorUndoTransaction[];
  cursor: number;
  savedCursor: number | null;
}

export interface EditorUndoHistoryOptions {
  maxTransactions?: number;
  maxBytes?: number;
}

const defaultMergeWindowMs = 1000;
const defaultMaxTransactions = 500;
const defaultMaxBytes = 16 * 1024 * 1024;

function cloneSelection(selection: EditorSelection): EditorSelection {
  return { start: selection.start, end: selection.end };
}

function selectionsEqual(left: EditorSelection, right: EditorSelection): boolean {
  return left.start === right.start && left.end === right.end;
}

function cloneTransaction(transaction: EditorUndoTransaction): EditorUndoTransaction {
  return {
    ...transaction,
    beforeSelection: cloneSelection(transaction.beforeSelection),
    afterSelection: cloneSelection(transaction.afterSelection)
  };
}

function createTransaction(
  before: EditorSnapshot,
  after: EditorSnapshot,
  mergeKey: string | null,
  timestamp: number,
  suppliedChange?: TextChange | null
): EditorUndoTransaction | null {
  if (before.content === after.content) return null;

  const changedRange = suppliedChange ?? getTextChange(before.content, after.content);
  if (!changedRange) return null;
  return {
    ...changedRange,
    beforeSelection: cloneSelection(before.selection),
    afterSelection: cloneSelection(after.selection),
    mergeKey,
    timestamp
  };
}

function applyForward(snapshot: EditorSnapshot, transaction: EditorUndoTransaction): EditorSnapshot {
  const beforeLength = transaction.beforeText.length;
  return {
    content:
      snapshot.content.slice(0, transaction.rangeStart) +
      transaction.afterText +
      snapshot.content.slice(transaction.rangeStart + beforeLength),
    selection: cloneSelection(transaction.afterSelection)
  };
}

function applyBackward(snapshot: EditorSnapshot, transaction: EditorUndoTransaction): EditorSnapshot {
  const afterLength = transaction.afterText.length;
  return {
    content:
      snapshot.content.slice(0, transaction.rangeStart) +
      transaction.beforeText +
      snapshot.content.slice(transaction.rangeStart + afterLength),
    selection: cloneSelection(transaction.beforeSelection)
  };
}

function canMergeTransactions(
  previous: EditorUndoTransaction,
  before: EditorSnapshot,
  mergeKey: string | null,
  timestamp: number,
  mergeWindowMs: number
): boolean {
  if (!mergeKey || previous.mergeKey !== mergeKey) return false;
  if (timestamp - previous.timestamp > mergeWindowMs) return false;
  return selectionsEqual(previous.afterSelection, before.selection);
}

function mergeSequentialTransactions(
  previous: EditorUndoTransaction,
  current: EditorUndoTransaction,
  intermediate: EditorSnapshot
): EditorUndoTransaction {
  const previousStart = previous.rangeStart;
  const previousBeforeEnd = previousStart + previous.beforeText.length;
  const previousAfterEnd = previousStart + previous.afterText.length;
  const currentStart = current.rangeStart;
  const currentEnd = currentStart + current.beforeText.length;
  const originalLengthDelta = previous.beforeText.length - previous.afterText.length;

  const mapStartToOriginal = (offset: number) => {
    if (offset <= previousStart) return offset;
    if (offset >= previousAfterEnd) return offset + originalLengthDelta;
    return previousStart;
  };
  const mapEndToOriginal = (offset: number) => {
    if (offset <= previousStart) return offset;
    if (offset >= previousAfterEnd) return offset + originalLengthDelta;
    return previousBeforeEnd;
  };

  const combinedStart = Math.min(previousStart, mapStartToOriginal(currentStart));
  const combinedOriginalEnd = Math.max(previousBeforeEnd, mapEndToOriginal(currentEnd));
  const prefix = combinedStart < previousStart
    ? intermediate.content.slice(combinedStart, previousStart)
    : '';
  const suffixLength = Math.max(0, combinedOriginalEnd - previousBeforeEnd);
  const suffix = suffixLength > 0
    ? intermediate.content.slice(previousAfterEnd, previousAfterEnd + suffixLength)
    : '';
  const beforeText = `${prefix}${previous.beforeText}${suffix}`;

  const combinedIntermediateEnd = combinedOriginalEnd
    + previous.afterText.length
    - previous.beforeText.length;
  const intermediateText = intermediate.content.slice(combinedStart, combinedIntermediateEnd);
  const currentRelativeStart = currentStart - combinedStart;
  const afterText = intermediateText.slice(0, currentRelativeStart)
    + current.afterText
    + intermediateText.slice(currentRelativeStart + current.beforeText.length);

  return {
    rangeStart: combinedStart,
    beforeText,
    afterText,
    beforeSelection: cloneSelection(previous.beforeSelection),
    afterSelection: cloneSelection(current.afterSelection),
    mergeKey: current.mergeKey,
    timestamp: current.timestamp
  };
}

export class EditorUndoHistory {
  private transactions: EditorUndoTransaction[] = [];
  private cursor = 0;
  private savedCursor: number | null = 0;
  private readonly maxTransactions: number;
  private readonly maxBytes: number;

  constructor(
    _initialSnapshot: EditorSnapshot,
    options: EditorUndoHistoryOptions = {}
  ) {
    this.maxTransactions = Math.max(1, Math.floor(options.maxTransactions ?? defaultMaxTransactions));
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? defaultMaxBytes));
  }

  getEstimatedBytes(): number {
    return this.transactions.reduce(
      (total, transaction) => total + ((transaction.beforeText.length + transaction.afterText.length) * 2) + 64,
      0
    );
  }

  private enforceHistoryBudget() {
    while (
      this.transactions.length > this.maxTransactions
      || this.getEstimatedBytes() > this.maxBytes
    ) {
      if (this.discardOldestAvailableTransaction() === 0) return;
    }
  }

  discardOldestAvailableTransaction(): number {
    if (this.transactions.length === 0) return 0;

    let removed: EditorUndoTransaction | undefined;
    if (this.cursor > 0) {
      removed = this.transactions.shift();
      this.cursor -= 1;
      if (this.savedCursor !== null) {
        this.savedCursor = this.savedCursor === 0 ? null : this.savedCursor - 1;
      }
    } else {
      removed = this.transactions.pop();
      if (this.savedCursor !== null && this.savedCursor > this.transactions.length) {
        this.savedCursor = null;
      }
    }

    return removed
      ? ((removed.beforeText.length + removed.afterText.length) * 2) + 64
      : 0;
  }

  record(before: EditorSnapshot, after: EditorSnapshot, options: EditorUndoRecordOptions = {}): boolean {
    const timestamp = options.timestamp ?? Date.now();
    const mergeKey = options.mergeKey ?? null;
    const mergeWindowMs = options.mergeWindowMs ?? defaultMergeWindowMs;

    const transaction = createTransaction(before, after, mergeKey, timestamp, options.change);
    if (!transaction) return false;

    if (this.cursor < this.transactions.length) {
      this.transactions = this.transactions.slice(0, this.cursor);
      if (this.savedCursor !== null && this.savedCursor > this.cursor) {
        this.savedCursor = null;
      }
    }

    const previous = this.transactions[this.cursor - 1];
    if (previous && canMergeTransactions(previous, before, mergeKey, timestamp, mergeWindowMs)) {
      this.transactions[this.cursor - 1] = mergeSequentialTransactions(previous, transaction, before);
      this.enforceHistoryBudget();
      return true;
    }

    this.transactions.push(transaction);
    this.cursor = this.transactions.length;
    this.enforceHistoryBudget();
    return true;
  }

  undo(current: EditorSnapshot): EditorSnapshot | null {
    if (!this.canUndo()) return null;

    const transaction = this.transactions[this.cursor - 1];
    this.cursor -= 1;
    return applyBackward(current, transaction);
  }

  redo(current: EditorSnapshot): EditorSnapshot | null {
    if (!this.canRedo()) return null;

    const transaction = this.transactions[this.cursor];
    this.cursor += 1;
    return applyForward(current, transaction);
  }

  reset(_snapshot: EditorSnapshot) {
    this.transactions = [];
    this.cursor = 0;
    this.savedCursor = 0;
  }

  markSaved() {
    this.closeGroup();
    this.savedCursor = this.cursor;
  }

  closeGroup() {
    const previous = this.transactions[this.cursor - 1];
    if (previous) {
      previous.mergeKey = null;
    }
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.transactions.length;
  }

  isDirty(): boolean {
    return this.savedCursor === null || this.cursor !== this.savedCursor;
  }

  exportState(): EditorUndoHistoryState {
    return {
      transactions: this.transactions.map(cloneTransaction),
      cursor: this.cursor,
      savedCursor: this.savedCursor
    };
  }

  static fromState(
    initialSnapshot: EditorSnapshot,
    state: EditorUndoHistoryState,
    options: EditorUndoHistoryOptions = {}
  ): EditorUndoHistory {
    const history = new EditorUndoHistory(initialSnapshot, options);
    history.transactions = state.transactions.map(cloneTransaction);
    history.cursor = Math.max(
      0,
      Math.min(Math.floor(state.cursor), history.transactions.length)
    );
    history.savedCursor = state.savedCursor === null
      ? null
      : Math.max(
          0,
          Math.min(Math.floor(state.savedCursor), history.transactions.length)
        );
    history.enforceHistoryBudget();
    return history;
  }
}

export class EditorUndoWindowBudget {
  private usageSequence = 0;
  private readonly lastUsed = new Map<string, number>();

  constructor(private readonly maximumBytes: number) {}

  touch(tabId: string) {
    this.usageSequence += 1;
    this.lastUsed.set(tabId, this.usageSequence);
  }

  remove(tabId: string) {
    this.lastUsed.delete(tabId);
  }

  getEstimatedBytes(histories: ReadonlyMap<string, EditorUndoHistory>): number {
    let total = 0;
    for (const history of histories.values()) total += history.getEstimatedBytes();
    return total;
  }

  enforce(histories: ReadonlyMap<string, EditorUndoHistory>, protectedTabId: string): number {
    let total = this.getEstimatedBytes(histories);
    const skipped = new Set<string>();

    while (total > this.maximumBytes) {
      let candidateId: string | null = null;
      let candidateUse = Number.POSITIVE_INFINITY;
      for (const [tabId, history] of histories) {
        if (tabId === protectedTabId || skipped.has(tabId) || history.getEstimatedBytes() === 0) continue;
        const lastUsed = this.lastUsed.get(tabId) ?? 0;
        if (lastUsed < candidateUse) {
          candidateUse = lastUsed;
          candidateId = tabId;
        }
      }

      if (!candidateId) break;
      const freed = histories.get(candidateId)?.discardOldestAvailableTransaction() ?? 0;
      if (freed === 0) {
        skipped.add(candidateId);
        continue;
      }
      total = Math.max(0, total - freed);
    }

    return total;
  }
}
