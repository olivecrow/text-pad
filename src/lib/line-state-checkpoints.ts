import { findLineIndexForOffset } from './structured-rendering';
import { isTextChangeTransition, type TextChange } from './text-change';

interface StoredLineState<State> {
  state: State;
}

export interface LineStateCheckpointCache<State> {
  content: string | null;
  context: string;
  lineStartOffsets: number[];
  checkpoints: Map<number, StoredLineState<State>>;
  visitedLineCount: number;
}

export function createLineStateCheckpointCache<State>(): LineStateCheckpointCache<State> {
  return {
    content: null,
    context: '',
    lineStartOffsets: [0],
    checkpoints: new Map(),
    visitedLineCount: 0
  };
}

function cloneState<State>(state: State, clone: (value: State) => State): State {
  return clone(state);
}

export function prepareLineStateCheckpointCache<State>(
  cache: LineStateCheckpointCache<State>,
  content: string,
  context: string,
  lineStartOffsets: number[],
  initialState: State,
  clone: (value: State) => State,
  change?: TextChange | null
) {
  cache.visitedLineCount = 0;
  if (cache.content === content && cache.context === context) return;

  const canRetainPrefix = cache.content !== null
    && cache.context === context
    && isTextChangeTransition(cache.content, content, change ?? null);

  if (!canRetainPrefix) {
    cache.checkpoints.clear();
    cache.checkpoints.set(0, { state: cloneState(initialState, clone) });
  } else if (change) {
    const changedLine = findLineIndexForOffset(cache.lineStartOffsets, change.rangeStart);
    for (const lineIndex of cache.checkpoints.keys()) {
      if (lineIndex > changedLine) cache.checkpoints.delete(lineIndex);
    }
    if (!cache.checkpoints.has(0)) {
      cache.checkpoints.set(0, { state: cloneState(initialState, clone) });
    }
  }

  cache.content = content;
  cache.context = context;
  cache.lineStartOffsets = lineStartOffsets;
}

export function storeLineStateCheckpoint<State>(
  cache: LineStateCheckpointCache<State>,
  lineIndex: number,
  state: State,
  clone: (value: State) => State,
  interval = 256
) {
  if (lineIndex === 0 || lineIndex % interval === 0) {
    cache.checkpoints.set(lineIndex, { state: cloneState(state, clone) });
  }
}

export function getLineStateAt<State>(
  cache: LineStateCheckpointCache<State>,
  targetLine: number,
  initialState: State,
  clone: (value: State) => State,
  advance: (lineIndex: number, state: State) => State,
  interval = 256
): State {
  let checkpointLine = 0;
  let state = cloneState(initialState, clone);
  for (const [lineIndex, stored] of cache.checkpoints) {
    if (lineIndex <= targetLine && lineIndex >= checkpointLine) {
      checkpointLine = lineIndex;
      state = cloneState(stored.state, clone);
    }
  }

  for (let lineIndex = checkpointLine; lineIndex < targetLine; lineIndex += 1) {
    state = advance(lineIndex, state);
    cache.visitedLineCount += 1;
    storeLineStateCheckpoint(cache, lineIndex + 1, state, clone, interval);
  }

  return state;
}
