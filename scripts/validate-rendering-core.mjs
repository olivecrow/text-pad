import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const root = process.cwd();
const server = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

function getSlowLineStarts(content) {
  const starts = [0];
  for (let offset = 0; offset < content.length; offset += 1) {
    if (content[offset] === '\n') starts.push(offset + 1);
  }
  return starts;
}

function slowContentOffsetToTextareaOffset(content, offset) {
  const target = Math.max(0, Math.min(offset, content.length));
  let textareaOffset = 0;
  for (let contentOffset = 0; contentOffset < target; contentOffset += 1) {
    if (content[contentOffset] === '\r' && content[contentOffset + 1] === '\n') continue;
    textareaOffset += 1;
  }
  return textareaOffset;
}

function slowTextareaOffsetToContentOffset(content, offset) {
  const textareaLength = content.replace(/\r\n/g, '\n').length;
  const target = Math.max(0, Math.min(offset, textareaLength));
  let textareaOffset = 0;

  for (let contentOffset = 0; contentOffset < content.length; contentOffset += 1) {
    if (textareaOffset >= target) return contentOffset;
    if (content[contentOffset] === '\r' && content[contentOffset + 1] === '\n') continue;
    textareaOffset += 1;
  }
  return content.length;
}

function flattenTokens(tokens) {
  return tokens.map((token) => token.children ? flattenTokens(token.children) : token.text || '').join('');
}

try {
  const offsets = await server.ssrLoadModule('/src/lib/text-offset-index.ts');
  const geometry = await server.ssrLoadModule('/src/lib/rendered-text-geometry.ts');
  const documentFormats = await server.ssrLoadModule('/src/lib/document-formats.ts');
  const delimited = await server.ssrLoadModule('/src/lib/delimited-table.ts');
  const budgets = await server.ssrLoadModule('/src/lib/render-budgets.ts');
  const listMarkers = await server.ssrLoadModule('/src/lib/list-markers.ts');
  const textChanges = await server.ssrLoadModule('/src/lib/text-change.ts');
  const editorInput = await server.ssrLoadModule('/src/lib/editor-input.ts');
  const editorLayout = await server.ssrLoadModule('/src/lib/editor-layout.ts');
  const boundedCollections = await server.ssrLoadModule('/src/lib/bounded-collections.ts');
  const editorUndo = await server.ssrLoadModule('/src/lib/editor-undo.ts');
  const diagnosticClient = await server.ssrLoadModule('/src/lib/document-diagnostic-client.ts');
  const autoPair = await server.ssrLoadModule('/src/lib/auto-pair.ts');

  const offsetSamples = [
    '',
    'plain text',
    'first\nsecond\n',
    'first\r\nsecond\r\n',
    'first\r\nsecond\nthird\r\nfourth',
    '\r\n\r\n'
  ];

  for (const content of offsetSamples) {
    const index = offsets.createTextOffsetIndex(content);
    assert.equal(index.textareaValue, content.replace(/\r\n/g, '\n'));
    assert.deepEqual(index.lineStartOffsets, getSlowLineStarts(content));

    for (let offset = -1; offset <= content.length + 1; offset += 1) {
      assert.equal(
        offsets.contentOffsetToTextareaOffset(index, offset),
        slowContentOffsetToTextareaOffset(content, offset),
        `content-to-textarea mismatch at ${offset} for ${JSON.stringify(content)}`
      );
    }
    for (let offset = -1; offset <= index.textareaValue.length + 1; offset += 1) {
      assert.equal(
        offsets.textareaOffsetToContentOffset(index, offset),
        slowTextareaOffsetToContentOffset(content, offset),
        `textarea-to-content mismatch at ${offset} for ${JSON.stringify(content)}`
      );
    }
  }

  const maximumOffset = 2_000_000;
  const columns = 1_000;
  const targetOffset = 1_234_567;
  const targetRow = Math.floor(targetOffset / columns);
  const targetColumn = targetOffset % columns;
  let rectCalls = 0;
  const closestOffset = geometry.findClosestRenderedTextOffset(
    maximumOffset,
    targetColumn * 2,
    targetRow * 20 + 10,
    2_000,
    (offset) => {
      rectCalls += 1;
      const row = Math.floor(offset / columns);
      const column = offset % columns;
      return {
        left: column * 2,
        right: column * 2 + 1,
        top: row * 20,
        bottom: row * 20 + 20,
        height: 20
      };
    }
  );
  assert.equal(closestOffset, targetOffset);
  assert.ok(rectCalls <= 40, `long-line hit testing used ${rectCalls} rectangle reads`);

  const xmlLineCount = 15_000;
  const xmlContent = Array.from(
    { length: xmlLineCount },
    (_, index) => `<item id="${index}">value ${index}</item>`
  ).join('\n');
  const xmlIndex = offsets.createTextOffsetIndex(xmlContent);
  const renderCache = documentFormats.createDocumentRenderCache();
  const xmlStartLine = xmlLineCount - 61;
  const parseStartedAt = performance.now();
  const xmlResult = documentFormats.parseDocumentForRender(xmlContent, {
    pathOrName: 'large.xml',
    tabSize: 4,
    lineStartOffsets: xmlIndex.lineStartOffsets,
    lineRange: { startLine: xmlStartLine, endLine: xmlLineCount - 1 },
    renderCache
  });
  const xmlParseDuration = performance.now() - parseStartedAt;

  assert.equal(xmlResult.format.id, 'xml');
  assert.equal(xmlResult.lines.length, 61);
  for (let index = 0; index < xmlResult.lines.length; index += 1) {
    const sourceLine = `<item id="${xmlStartLine + index}">value ${xmlStartLine + index}</item>`;
    assert.equal(flattenTokens(xmlResult.lines[index].tokens), sourceLine);
  }
  assert.ok(
    xmlParseDuration < 1_500,
    `large XML visible-range parse took ${xmlParseDuration.toFixed(1)}ms`
  );

  assert.deepEqual(autoPair.createDefaultAutoPairAllowedFollowingStrings(), ['=', ':']);
  assert.deepEqual(autoPair.parseAutoPairAllowedFollowingStrings(null), ['=', ':']);
  assert.deepEqual(autoPair.parseAutoPairAllowedFollowingStrings('[]'), []);
  assert.deepEqual(autoPair.parseAutoPairAllowedFollowingStrings('["=","="," : "]'), ['=', ':']);
  assert.deepEqual(autoPair.parseAutoPairAllowedFollowingStrings('{broken'), ['=', ':']);
  assert.equal(autoPair.canInsertAutoPairAt('', 0, ['=', ':']), true);
  assert.equal(autoPair.canInsertAutoPairAt('body', 0, ['=', ':']), false);
  assert.equal(autoPair.canInsertAutoPairAt(' body', 0, []), true);
  assert.equal(autoPair.canInsertAutoPairAt('\tbody', 0, []), true);
  assert.equal(autoPair.canInsertAutoPairAt('\nbody', 0, []), true);
  assert.equal(autoPair.canInsertAutoPairAt('=body', 0, ['=', ':']), true);
  assert.equal(autoPair.canInsertAutoPairAt(': body', 0, ['=', ':']), true);
  assert.equal(autoPair.canInsertAutoPairAt('=> body', 0, ['=>']), true);
  assert.equal(autoPair.canInsertAutoPairAt('prefix value', 7, ['value']), true);
  assert.equal(autoPair.canInsertAutoPairAt('prefix value', 7, []), false);

  const cachedTokens = renderCache.xml.tokens;
  documentFormats.parseDocumentForRender(xmlContent, {
    pathOrName: 'large.xml',
    tabSize: 4,
    lineStartOffsets: xmlIndex.lineStartOffsets,
    lineRange: { startLine: 0, endLine: 60 },
    renderCache
  });
  assert.strictEqual(renderCache.xml.tokens, cachedTokens, 'XML tokens were rebuilt for an unchanged document');

  assert.equal(budgets.MAX_INTERACTIVE_TABLE_CELLS, 2_000);
  const orderedMarkerEdit = listMarkers.getListMarkerBackspaceEdit('1. body', 3);
  assert.deepEqual(orderedMarkerEdit, { text: '1body', caret: 1 });
  const nestedMarkerEdit = listMarkers.getListMarkerBackspaceEdit('    (1) body', 8);
  assert.deepEqual(nestedMarkerEdit, { text: '    (1body', caret: 6 });
  const unorderedMarkerEdit = listMarkers.getListMarkerBackspaceEdit('• body', 2);
  assert.deepEqual(unorderedMarkerEdit, { text: 'body', caret: 0 });
  assert.equal(listMarkers.getListMarkerBackspaceEdit('1. body', 4), null);

  const tableRow = Array.from({ length: 10 }, (_, index) => `value-${index}`).join(',');
  const interactiveTableContent = Array.from({ length: 200 }, () => tableRow).join('\n');
  const oversizedTableContent = `${interactiveTableContent}\n${tableRow}`;
  assert.ok(delimited.parseDelimitedTableWithinCellLimit(
    interactiveTableContent,
    ',',
    budgets.MAX_INTERACTIVE_TABLE_CELLS
  ));
  assert.equal(delimited.parseDelimitedTableWithinCellLimit(
    oversizedTableContent,
    ',',
    budgets.MAX_INTERACTIVE_TABLE_CELLS
  ), null);

  const tableDocument = {
    rows: [['a', 'b'], ['c', 'd'], ['e', 'f']],
    separator: ',',
    lineEnding: '\n',
    hasTrailingLineEnding: false
  };
  const updatedTable = delimited.updateDelimitedTableCell(tableDocument, 1, 1, 'changed');
  assert.notStrictEqual(updatedTable.rows, tableDocument.rows);
  assert.strictEqual(updatedTable.rows[0], tableDocument.rows[0]);
  assert.notStrictEqual(updatedTable.rows[1], tableDocument.rows[1]);
  assert.strictEqual(updatedTable.rows[2], tableDocument.rows[2]);
  assert.equal(updatedTable.rows[1][1], 'changed');
  assert.equal(tableDocument.rows[1][1], 'd');

  const nativeBefore = {
    content: 'alpha\r\nbeta\r\ngamma',
    selection: { start: 7, end: 7 }
  };
  const nativeBeforeIndex = offsets.createTextOffsetIndex(nativeBefore.content);
  const nativeTextareaValue = nativeBeforeIndex.textareaValue.replace('beta', 'BETA!');
  const nativeSelection = nativeTextareaValue.indexOf('BETA!') + 'BETA!'.length;
  const nativeInput = editorInput.getSnapshotFromTextareaInput(
    nativeBefore,
    nativeBeforeIndex,
    nativeTextareaValue,
    nativeSelection,
    nativeSelection
  );
  assert.equal(nativeInput.snapshot.content, 'alpha\r\nBETA!\r\ngamma');
  assert.deepEqual(nativeInput.change, {
    rangeStart: 7,
    beforeText: 'beta',
    afterText: 'BETA!'
  });
  assert.strictEqual(nativeInput.offsetIndex.content, nativeInput.snapshot.content);

  const inputHistory = new editorUndo.EditorUndoHistory(nativeBefore);
  inputHistory.record(nativeBefore, nativeInput.snapshot, { change: nativeInput.change });
  assert.deepEqual(inputHistory.undo(nativeInput.snapshot), nativeBefore);

  const mergePrefix = 'x'.repeat(100_000);
  const mergeInitial = {
    content: `${mergePrefix}END`,
    selection: { start: mergePrefix.length, end: mergePrefix.length }
  };
  const mergeHistory = new editorUndo.EditorUndoHistory(mergeInitial);
  const mergeFirst = {
    content: `${mergePrefix}aEND`,
    selection: { start: mergePrefix.length + 1, end: mergePrefix.length + 1 }
  };
  const mergeSecond = {
    content: `${mergePrefix}abEND`,
    selection: { start: mergePrefix.length + 2, end: mergePrefix.length + 2 }
  };
  mergeHistory.record(mergeInitial, mergeFirst, {
    mergeKey: 'insert-text',
    timestamp: 1,
    change: textChanges.getTextChange(mergeInitial.content, mergeFirst.content)
  });
  mergeHistory.record(mergeFirst, mergeSecond, {
    mergeKey: 'insert-text',
    timestamp: 2,
    change: textChanges.getTextChange(mergeFirst.content, mergeSecond.content)
  });
  assert.equal(mergeHistory.exportState().transactions.length, 1);
  assert.deepEqual(mergeHistory.undo(mergeSecond), mergeInitial);
  assert.deepEqual(mergeHistory.redo(mergeInitial), mergeSecond);

  const deleteInitial = { content: 'prefixAB', selection: { start: 8, end: 8 } };
  const deleteFirst = { content: 'prefixA', selection: { start: 7, end: 7 } };
  const deleteSecond = { content: 'prefix', selection: { start: 6, end: 6 } };
  const deleteHistory = new editorUndo.EditorUndoHistory(deleteInitial);
  deleteHistory.record(deleteInitial, deleteFirst, {
    mergeKey: 'delete-backward',
    timestamp: 1,
    change: textChanges.getTextChange(deleteInitial.content, deleteFirst.content)
  });
  deleteHistory.record(deleteFirst, deleteSecond, {
    mergeKey: 'delete-backward',
    timestamp: 2,
    change: textChanges.getTextChange(deleteFirst.content, deleteSecond.content)
  });
  assert.deepEqual(deleteHistory.undo(deleteSecond), deleteInitial);
  const compositionInitial = { content: '0123456789', selection: { start: 3, end: 6 } };
  const compositionFirst = { content: '012abc6789', selection: { start: 6, end: 6 } };
  const compositionSecond = { content: '012aXc6789', selection: { start: 5, end: 5 } };
  const compositionHistory = new editorUndo.EditorUndoHistory(compositionInitial);
  compositionHistory.record(compositionInitial, compositionFirst, {
    mergeKey: 'composition',
    timestamp: 1,
    change: textChanges.getTextChange(compositionInitial.content, compositionFirst.content)
  });
  compositionHistory.record(
    { ...compositionFirst, selection: { start: 6, end: 6 } },
    compositionSecond,
    {
      mergeKey: 'composition',
      timestamp: 2,
      change: textChanges.getTextChange(compositionFirst.content, compositionSecond.content)
    }
  );
  assert.equal(compositionHistory.exportState().transactions.length, 1);
  assert.deepEqual(compositionHistory.undo(compositionSecond), compositionInitial);
  assert.deepEqual(compositionHistory.redo(compositionInitial), compositionSecond);


  const uniformLineCount = 250_000;
  const uniformContent = Array.from({ length: uniformLineCount }, () => 'x').join('\n');
  const uniformIndex = offsets.createTextOffsetIndex(uniformContent);
  const uniformCache = editorLayout.createEditorLineLayoutCache();
  const uniformStartedAt = performance.now();
  const uniformLayout = editorLayout.getEditorLineLayout(uniformCache, {
    content: uniformContent,
    lineStartOffsets: uniformIndex.lineStartOffsets,
    contentWidth: 80,
    fencedCodeRanges: [],
    wrapEnabled: false,
    measurements: { content: '', context: '', heights: {} },
    measurementContext: 'source',
    measuredLineHeight: 20,
    fencedCodeHorizontalPadding: 12,
    measureTextEndWidth: (text, start = 0) => start + text.length,
    measureTextWidth: (text) => text.length,
    getListContinuationIndent: (marker) => listMarkers.getListContinuationIndent(marker, 4)
  });
  const uniformDuration = performance.now() - uniformStartedAt;
  assert.equal(uniformLayout.lineCount, uniformLineCount);
  assert.equal(uniformLayout.totalHeight, uniformLineCount * 20);
  assert.equal(uniformLayout.visitedLineCount, 0);
  assert.equal(uniformLayout.listLayouts.length, 0);
  assert.equal(uniformLayout.findLineIndex(4_321_234), 216_061);
  const modeContent = '1. item\n   continuation';
  const modeIndex = offsets.createTextOffsetIndex(modeContent);
  const modeCache = editorLayout.createEditorLineLayoutCache();
  const modeOptions = {
    content: modeContent,
    lineStartOffsets: modeIndex.lineStartOffsets,
    contentWidth: 12,
    fencedCodeRanges: [],
    measurements: { content: '', context: '', heights: {} },
    measurementContext: 'mode-switch',
    measuredLineHeight: 20,
    fencedCodeHorizontalPadding: 12,
    measureTextEndWidth: (text, start = 0) => start + text.length,
    measureTextWidth: (text) => text.length,
    getListContinuationIndent: (marker) => listMarkers.getListContinuationIndent(marker, 4)
  };
  editorLayout.getEditorLineLayout(modeCache, { ...modeOptions, wrapEnabled: false });
  const wrappedAfterSource = editorLayout.getEditorLineLayout(modeCache, {
    ...modeOptions,
    wrapEnabled: true
  });
  assert.equal(wrappedAfterSource.visitedLineCount, modeIndex.lineStartOffsets.length);
  assert.equal(wrappedAfterSource.listLayouts.length, modeIndex.lineStartOffsets.length);
  assert.ok(wrappedAfterSource.listLayouts[1]);
  assert.equal(editorLayout.getRenderListIndentGuideCount(wrappedAfterSource.listLayouts[1], 4), 0);
  const sourceAfterWrapped = editorLayout.getEditorLineLayout(modeCache, {
    ...modeOptions,
    wrapEnabled: false
  });
  assert.equal(sourceAfterWrapped.visitedLineCount, 0);
  assert.equal(sourceAfterWrapped.listLayouts.length, 0);

  const nestedModeContent = '    1. item\n       continuation';
  const nestedModeIndex = offsets.createTextOffsetIndex(nestedModeContent);
  const nestedModeLayout = editorLayout.getEditorLineLayout(editorLayout.createEditorLineLayoutCache(), {
    ...modeOptions,
    content: nestedModeContent,
    lineStartOffsets: nestedModeIndex.lineStartOffsets,
    wrapEnabled: true
  });
  assert.ok(nestedModeLayout.listLayouts[1]);
  assert.equal(editorLayout.getRenderListIndentGuideCount(nestedModeLayout.listLayouts[1], 4), 1);


  const wrappedLineCount = 12_000;
  const wrappedContent = Array.from(
    { length: wrappedLineCount },
    (_, index) => index % 7 === 0 ? `${index + 1}. wrapped body text` : `plain line ${index}`
  ).join('\n');
  const wrappedIndex = offsets.createTextOffsetIndex(wrappedContent);
  const fencedCache = editorLayout.createFencedCodeBlockCache();
  const fencedRanges = editorLayout.getFencedCodeBlockRanges(
    fencedCache,
    wrappedContent,
    wrappedIndex.lineStartOffsets
  );
  const layoutOptions = {
    content: wrappedContent,
    lineStartOffsets: wrappedIndex.lineStartOffsets,
    contentWidth: 16,
    fencedCodeRanges: fencedRanges,
    wrapEnabled: true,
    measurements: { content: '', context: '', heights: {} },
    measurementContext: 'render',
    measuredLineHeight: 20,
    fencedCodeHorizontalPadding: 12,
    measureTextEndWidth: (text, start = 0) => start + text.length,
    measureTextWidth: (text) => text.length,
    getListContinuationIndent: (marker) => listMarkers.getListContinuationIndent(marker, 4)
  };
  const incrementalLayoutCache = editorLayout.createEditorLineLayoutCache();
  editorLayout.getEditorLineLayout(incrementalLayoutCache, layoutOptions);
  const wrappedChange = {
    rangeStart: wrappedContent.lastIndexOf('plain line'),
    beforeText: 'plain',
    afterText: 'PLAIN'
  };
  const changedWrappedContent = textChanges.applyTextChange(wrappedContent, wrappedChange);
  const changedWrappedIndex = offsets.createTextOffsetIndex(changedWrappedContent);
  const changedFencedRanges = editorLayout.getFencedCodeBlockRanges(
    fencedCache,
    changedWrappedContent,
    changedWrappedIndex.lineStartOffsets,
    wrappedChange
  );
  const incrementalLayout = editorLayout.getEditorLineLayout(incrementalLayoutCache, {
    ...layoutOptions,
    content: changedWrappedContent,
    lineStartOffsets: changedWrappedIndex.lineStartOffsets,
    fencedCodeRanges: changedFencedRanges,
    change: wrappedChange
  });
  assert.ok(incrementalLayout.visitedLineCount <= 2, `layout revisited ${incrementalLayout.visitedLineCount} lines`);
  assert.ok(fencedCache.visitedLineCount <= 2, `fence scan revisited ${fencedCache.visitedLineCount} lines`);
  const freshLayout = editorLayout.getEditorLineLayout(editorLayout.createEditorLineLayoutCache(), {
    ...layoutOptions,
    content: changedWrappedContent,
    lineStartOffsets: changedWrappedIndex.lineStartOffsets,
    fencedCodeRanges: changedFencedRanges,
    change: null
  });
  assert.equal(incrementalLayout.totalHeight, freshLayout.totalHeight);
  for (const lineIndex of [0, 1, 6, 7, wrappedLineCount - 2, wrappedLineCount - 1]) {
    assert.equal(incrementalLayout.getLineTop(lineIndex), freshLayout.getLineTop(lineIndex));
    assert.equal(incrementalLayout.getLineHeight(lineIndex), freshLayout.getLineHeight(lineIndex));
    assert.deepEqual(incrementalLayout.listLayouts[lineIndex], freshLayout.listLayouts[lineIndex]);
  }

  function assertCheckpointedRender(pathOrName, content, range, cacheField) {
    const index = offsets.createTextOffsetIndex(content);
    const cache = documentFormats.createDocumentRenderCache();
    const cached = documentFormats.parseDocumentForRender(content, {
      pathOrName,
      tabSize: 4,
      lineStartOffsets: index.lineStartOffsets,
      lineRange: range,
      renderCache: cache
    });
    const initialVisits = cache[cacheField].visitedLineCount;
    const repeated = documentFormats.parseDocumentForRender(content, {
      pathOrName,
      tabSize: 4,
      lineStartOffsets: index.lineStartOffsets,
      lineRange: range,
      renderCache: cache
    });
    const repeatedVisits = cache[cacheField].visitedLineCount;
    const fresh = documentFormats.parseDocumentForRender(content, {
      pathOrName,
      tabSize: 4,
      lineStartOffsets: index.lineStartOffsets,
      lineRange: range
    });
    assert.deepEqual(repeated.lines, fresh.lines, `${pathOrName} cached tokens changed`);
    assert.deepEqual(cached.lines, fresh.lines, `${pathOrName} initial cached tokens changed`);
    assert.ok(initialVisits > 1_000, `${pathOrName} did not exercise a deep prefix`);
    assert.ok(repeatedVisits <= 320, `${pathOrName} revisited ${repeatedVisits} lines`);
    return { cache, index };
  }

  const markdownLines = Array.from({ length: 12_000 }, (_, index) => {
    if (index === 2) return '<!--';
    if (index === 11_850) return '-->';
    return `markdown ${index}`;
  });
  const markdownContent = markdownLines.join('\n');
  const markdownRange = { startLine: 11_700, endLine: 11_760 };
  const markdownCheckpoint = assertCheckpointedRender(
    'large.md',
    markdownContent,
    markdownRange,
    'lineOriented'
  );
  const markdownChange = {
    rangeStart: markdownCheckpoint.index.lineStartOffsets[11_990],
    beforeText: 'markdown',
    afterText: 'MARKDOWN'
  };
  const changedMarkdown = textChanges.applyTextChange(markdownContent, markdownChange);
  const changedMarkdownIndex = offsets.createTextOffsetIndex(changedMarkdown);
  const changedMarkdownRange = { startLine: 11_980, endLine: 11_999 };
  const changedMarkdownCached = documentFormats.parseDocumentForRender(changedMarkdown, {
    pathOrName: 'large.md',
    tabSize: 4,
    lineStartOffsets: changedMarkdownIndex.lineStartOffsets,
    lineRange: changedMarkdownRange,
    renderCache: markdownCheckpoint.cache,
    contentChange: markdownChange
  });
  const changedMarkdownFresh = documentFormats.parseDocumentForRender(changedMarkdown, {
    pathOrName: 'large.md',
    tabSize: 4,
    lineStartOffsets: changedMarkdownIndex.lineStartOffsets,
    lineRange: changedMarkdownRange
  });
  assert.deepEqual(changedMarkdownCached.lines, changedMarkdownFresh.lines);
  assert.ok(
    markdownCheckpoint.cache.lineOriented.visitedLineCount <= 520,
    `markdown edit revisited ${markdownCheckpoint.cache.lineOriented.visitedLineCount} lines`
  );

  const jsoncContent = ['{', '  /*', ...Array.from({ length: 6_000 }, (_, i) => `  comment ${i}`), '  */', '  "ok": true', '}'].join('\n');
  assertCheckpointedRender(
    'large.jsonc',
    jsoncContent,
    { startLine: 5_700, endLine: 5_760 },
    'jsonc'
  );
  const yamlContent = ['message: |', ...Array.from({ length: 6_000 }, (_, i) => `  value ${i}`), 'done: true'].join('\n');
  assertCheckpointedRender(
    'large.yaml',
    yamlContent,
    { startLine: 5_700, endLine: 5_760 },
    'yaml'
  );

  const lru = new boundedCollections.BoundedLruCache(2);
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.size, 2);
  const recent = new boundedCollections.BoundedRecentSet(2);
  recent.add('a');
  recent.add('b');
  recent.add('c');
  assert.equal(recent.has('a'), false);
  assert.equal(recent.has('c'), true);

  const budgetHistories = new Map();
  for (const id of ['first', 'second', 'active']) {
    const initial = { content: '', selection: { start: 0, end: 0 } };
    const after = { content: id.repeat(1_000), selection: { start: id.length * 1_000, end: id.length * 1_000 } };
    const history = new editorUndo.EditorUndoHistory(initial, { maxBytes: 1_000_000 });
    history.record(initial, after, { change: textChanges.getTextChange(initial.content, after.content) });
    budgetHistories.set(id, history);
  }
  const windowBudget = new editorUndo.EditorUndoWindowBudget(14_000);
  windowBudget.touch('first');
  windowBudget.touch('second');
  windowBudget.touch('active');
  const remainingUndoBytes = windowBudget.enforce(budgetHistories, 'active');
  assert.ok(remainingUndoBytes <= 14_000);
  assert.equal(budgetHistories.get('active').canUndo(), true);
  assert.equal(budgetHistories.get('first').canUndo(), false);

  const fakeWorkers = [];
  const workerClient = new diagnosticClient.DocumentDiagnosticWorkerClient(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      request: null,
      terminated: false,
      postMessage(request) { this.request = request; },
      terminate() { this.terminated = true; }
    };
    fakeWorkers.push(worker);
    return worker;
  });
  const firstDiagnostic = workerClient.diagnose({ requestId: 1, content: '{}', pathOrName: 'a.json', featureSettings: {}, locale: 'en' });
  const firstCancellation = assert.rejects(
    firstDiagnostic,
    (error) => error instanceof diagnosticClient.DocumentDiagnosticCancelledError
  );
  const secondDiagnostic = workerClient.diagnose({ requestId: 2, content: '{}', pathOrName: 'b.json', featureSettings: {}, locale: 'en' });
  await firstCancellation;
  assert.equal(fakeWorkers[0].terminated, true);
  fakeWorkers[1].onmessage({ data: { requestId: 2, diagnostic: null, durationMs: 1 } });
  assert.equal((await secondDiagnostic).requestId, 2);
  assert.equal(fakeWorkers[1].terminated, true);

  console.log(
    `Validated render core: CRLF offsets, logarithmic hit testing (${rectCalls} reads), `
      + `XML range cache (${xmlParseDuration.toFixed(1)}ms), 250k-line uniform layout (${uniformDuration.toFixed(1)}ms), `
      + `incremental layout/parser checkpoints, shared input diffs, bounded caches/undo, worker cancellation, `
      + `auto-pair right-context rules, list-marker backspace, and table copy-on-write.`
  );
} finally {
  await server.close();
}
