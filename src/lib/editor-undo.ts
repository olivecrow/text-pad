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

function getChangedRange(before: string, after: string) {
  let prefixLength = 0;
  const minLength = Math.min(before.length, after.length);

  while (prefixLength < minLength && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let beforeSuffix = before.length;
  let afterSuffix = after.length;

  while (
    beforeSuffix > prefixLength &&
    afterSuffix > prefixLength &&
    before[beforeSuffix - 1] === after[afterSuffix - 1]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  return {
    rangeStart: prefixLength,
    beforeText: before.slice(prefixLength, beforeSuffix),
    afterText: after.slice(prefixLength, afterSuffix)
  };
}

function createTransaction(
  before: EditorSnapshot,
  after: EditorSnapshot,
  mergeKey: string | null,
  timestamp: number
): EditorUndoTransaction | null {
  if (before.content === after.content) return null;

  const changedRange = getChangedRange(before.content, after.content);
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

  private getHistoryBytes(): number {
    return this.transactions.reduce(
      (total, transaction) => total + ((transaction.beforeText.length + transaction.afterText.length) * 2) + 64,
      0
    );
  }

  private enforceHistoryBudget() {
    while (
      this.transactions.length > this.maxTransactions
      || this.getHistoryBytes() > this.maxBytes
    ) {
      if (this.transactions.length === 1) {
        this.transactions = [];
        this.cursor = 0;
        this.savedCursor = null;
        return;
      }

      this.transactions.shift();
      this.cursor = Math.max(0, this.cursor - 1);
      if (this.savedCursor !== null) {
        this.savedCursor = this.savedCursor === 0 ? null : this.savedCursor - 1;
      }
    }
  }

  record(before: EditorSnapshot, after: EditorSnapshot, options: EditorUndoRecordOptions = {}): boolean {
    const timestamp = options.timestamp ?? Date.now();
    const mergeKey = options.mergeKey ?? null;
    const mergeWindowMs = options.mergeWindowMs ?? defaultMergeWindowMs;

    const transaction = createTransaction(before, after, mergeKey, timestamp);
    if (!transaction) return false;

    if (this.cursor < this.transactions.length) {
      this.transactions = this.transactions.slice(0, this.cursor);
      if (this.savedCursor !== null && this.savedCursor > this.cursor) {
        this.savedCursor = null;
      }
    }

    const previous = this.transactions[this.cursor - 1];
    if (previous && canMergeTransactions(previous, before, mergeKey, timestamp, mergeWindowMs)) {
      const mergedBefore = applyBackward(before, previous);
      const merged = createTransaction(mergedBefore, after, mergeKey, timestamp);
      if (merged) {
        this.transactions[this.cursor - 1] = merged;
        this.enforceHistoryBudget();
        return true;
      }
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
}
