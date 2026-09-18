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

function createFakeRenderViewportScheduler() {
  let nextHandle = 1;
  const timeouts = new Map();
  const animationFrames = new Map();

  return {
    scheduler: {
      setTimeout(callback) {
        const handle = nextHandle;
        nextHandle += 1;
        timeouts.set(handle, callback);
        return handle;
      },
      clearTimeout(handle) {
        timeouts.delete(handle);
      },
      requestAnimationFrame(callback) {
        const handle = nextHandle;
        nextHandle += 1;
        animationFrames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame(handle) {
        animationFrames.delete(handle);
      }
    },
    get timeoutCount() {
      return timeouts.size;
    },
    get animationFrameCount() {
      return animationFrames.size;
    },
    flushTimeouts() {
      const callbacks = [...timeouts.values()];
      timeouts.clear();
      for (const callback of callbacks) callback();
    },
    flushAnimationFrame() {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback();
    }
  };
}

try {
  const offsets = await server.ssrLoadModule('/src/lib/text-offset-index.ts');
  const geometry = await server.ssrLoadModule('/src/lib/rendered-text-geometry.ts');
  const documentFormats = await server.ssrLoadModule('/src/lib/document-formats.ts');
  const delimited = await server.ssrLoadModule('/src/lib/delimited-table.ts');
  const markdownTables = await server.ssrLoadModule('/src/lib/markdown-table.ts');
  const tables = await server.ssrLoadModule('/src/lib/table-document.ts');
  const tableColumns = await server.ssrLoadModule('/src/lib/table-column-layout.ts');
  assert.deepEqual(tableColumns.getTableColumnTextWeights({ rows: [['H', 'Name', ''], ['한😀', '\r\nabc'], ['z']] }), [2, Math.sqrt(7), 0]);
  // 내용이 16배 많아도 자동 너비는 4배만 배분하고, 수동 너비에는 보정을 반복하지 않는다.
  const softenedWeights = tableColumns.getTableColumnTextWeights({ rows: [['x', 'x'.repeat(16)]] });
  assert.deepEqual(tableColumns.allocateTableColumnWidths(softenedWeights, 1000), [200, 800]);
  assert.deepEqual(tableColumns.allocateTableColumnWidths([1, 3], 400), [100, 300]);
  assert.deepEqual(tableColumns.allocateTableColumnWidths([0, 1, 9], 500), [100, 100, 300]);
  assert.deepEqual(tableColumns.allocateTableColumnWidths([0, 0, 0], 600), [200, 200, 200]);
  assert.deepEqual(tableColumns.allocateTableColumnWidths([0], 457), [457]);
  assert.deepEqual(tableColumns.allocateTableColumnWidths(Array(20).fill(1), 457), Array(20).fill(100));
  assert.deepEqual(tableColumns.allocateTableColumnWidths([], 500), []);
  for (const available of [457, 600, 1000, 1800]) {
    const weights = [1, 300, 0, 50, 4, 160, 20];
    const widths = tableColumns.allocateTableColumnWidths(weights, available);
    assert.ok(widths.every((width) => width >= 100));
    assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - Math.max(available, weights.length * 100)) < 0.001);
    if (widths[1] > 100 && widths[5] > 100) {
      assert.ok(Math.abs(widths[1] / widths[5] - weights[1] / weights[5]) < 0.001);
    }
  }
  const parseTables = (content, limit = 2000) => markdownTables.parseMarkdownTables(
    content, offsets.createTextOffsetIndex(content).lineStartOffsets, limit
  );
  for (const newline of ['\n', '\r\n']) {
    const source = ['before', '', '| Name | Count |', '| :--- | ---: |', '| A\\|B | 2 |', '', 'after'].join(newline);
    const [block] = parseTables(source);
    assert.ok(block);
    assert.deepEqual(block.document.rows, [['Name', 'Count'], ['A|B', '2']]);
    assert.deepEqual(block.document.columnAlignments, ['left', 'right']);
    assert.equal(block.lineEnding, newline);
    for (const value of ['new | value', ' trailing ', '  ', '\tvalue\t', 'line\nnext', '\\|', '<br>', '<img src=x onerror=alert(1)>', '&amp;']) {
      const next = markdownTables.replaceMarkdownTable(source, block,
        tables.updateTableCell(block.document, 1, 0, value), { row: 1, column: 0 });
      assert.equal(parseTables(next)[0].document.rows[1][0], value);
      assert.equal(next, source.slice(0, block.cells[1][0].start)
        + markdownTables.encodeMarkdownTableCell(value) + source.slice(block.cells[1][0].end));
    }
    const moved = tables.moveTableColumn(block.document, 0, 1);
    assert.deepEqual(moved.columnAlignments, ['right', 'left']);
    const movedSource = markdownTables.replaceMarkdownTable(source, block, moved);
    assert.deepEqual(parseTables(movedSource)[0].document, moved);
    assert.ok(movedSource.startsWith(`before${newline}${newline}`));
    assert.ok(movedSource.endsWith(`${newline}${newline}after`));
    assert.equal(markdownTables.replaceMarkdownTable('changed', block, moved), 'changed');
    const pipeOffset = block.cells[1][0].offsets[2];
    assert.equal(source.slice(block.cells[1][0].start, pipeOffset), 'A\\|');
  }
  assert.equal(parseTables('a | b\n--- | ---\nx | y').length, 1);
  assert.equal(parseTables('| a |\n| :---: |').length, 1);
  assert.deepEqual(parseTables('| a | b |\n| - | - |\n| x |')[0].document.rows[1], ['x', '']);
  for (const source of [
    '| --- | --- |', '| a | b |\n| --- |', '| a | b |\n| -- x | --- |',
    '    | a |\n    | --- |', '> | a |\n> | --- |',
    '```md\n| a |\n| --- |\n```', '~~~\n| a |\n| --- |\n~~~',
    '<!--\n| a |\n| --- |\n-->', '| a |\n| --- |\n| x | y |',
    '- item\n\n  | a | b |\n  | --- | --- |\n  | x | y |'
  ]) assert.equal(parseTables(source).length, 0, source);
  assert.equal(parseTables('| a | b |\n| --- | --- |\n| x | y |', 3).length, 0);
  const repeatedTable = '| a | b |\n| --- | --- |\n| x | y |\n\n';
  assert.equal(parseTables(repeatedTable.repeat(2), 4).length, 1);
  assert.equal(parseTables('| a |\n| --- |\n\n```\n| b |\n| --- |\n```').length, 1);
  assert.equal(parseTables('- item\n\n  indented\n\n| a |\n| --- |').length, 1);
  const budgets = await server.ssrLoadModule('/src/lib/render-budgets.ts');
  const listMarkers = await server.ssrLoadModule('/src/lib/list-markers.ts');
  const checkboxMarkers = await server.ssrLoadModule('/src/lib/checkbox-markers.ts');
  const textChanges = await server.ssrLoadModule('/src/lib/text-change.ts');
  const editorInput = await server.ssrLoadModule('/src/lib/editor-input.ts');
  const editorCommands = await server.ssrLoadModule('/src/lib/editor-command-pipeline.ts');
  const editorDuplication = await server.ssrLoadModule('/src/lib/editor-duplication.ts');
  const editorLayout = await server.ssrLoadModule('/src/lib/editor-layout.ts');
  const editorScrollExtent = await server.ssrLoadModule('/src/lib/editor-scroll-extent.ts');
  const renderViewport = await server.ssrLoadModule('/src/lib/render-viewport-controller.ts');
  const boundedCollections = await server.ssrLoadModule('/src/lib/bounded-collections.ts');
  const editorUndo = await server.ssrLoadModule('/src/lib/editor-undo.ts');
  const diagnosticClient = await server.ssrLoadModule('/src/lib/document-diagnostic-client.ts');
  const autoPair = await server.ssrLoadModule('/src/lib/auto-pair.ts');
  const jsonPairEnter = await server.ssrLoadModule('/src/lib/json-pair-enter.ts');
  const pairedDelimiterHighlighting = await server.ssrLoadModule('/src/lib/paired-delimiter-highlighting.ts');
  const arrowSubstitution = await server.ssrLoadModule('/src/lib/arrow-substitution.ts');
  const markdownHeadingEdit = await server.ssrLoadModule('/src/lib/markdown-heading-edit.ts');
  const tokenizer = await server.ssrLoadModule('/src/lib/render-tokenizer.ts');
  const markdownRich = await server.ssrLoadModule('/src/lib/markdown-rich-text.ts');
  const emphasisCases = [
    ['*italic* **bold**', ['emphasis', 'strong']],
    ['**bold *nested* end**', ['strong', 'emphasis']],
    ['*italic **nested** end*', ['emphasis', 'strong']],
    ['***both*** ___both___', ['emphasis', 'strong', 'emphasis', 'strong']],
    ['"**quoted**" and \'*quoted*\'', ['strong', 'emphasis']],
    ['a_b_c a__b__c * spaced * ** spaced **', []],
    ['\\*literal\\* **closed** unmatched*', ['strong']],
    ['``*literal* ` **literal**`` **bold**', ['strong']],
    ['~~old **bold**~~', ['strike', 'strong']],
    ['**한글 *중첩😀* 강조**', ['strong', 'emphasis']]
  ];
  const emphasisTypes = (tokens) => tokens.flatMap((token) => [
    ...(['strong', 'emphasis', 'strike'].includes(token.type) ? [token.type] : []),
    ...emphasisTypes(token.children || [])
  ]);
  for (const [source, expected] of emphasisCases) {
    const tokens = tokenizer.tokenizeLine(source, { markdown: { hideHeadingMarkers: true } });
    assert.equal(flattenTokens(tokens), source, 'Emphasis must preserve every source character');
    assert.deepEqual(emphasisTypes(tokens), expected, source);
  }
  for (const newline of ['\n', '\r\n']) {
    const quote = ['> first', '> **second**', '>', '> > nested', '> tail'].join(newline);
    const source = `before${newline}${newline}${quote}${newline}${newline}after`;
    const blocks = markdownRich.parseMarkdownRichBlocks(source, getSlowLineStarts(source));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].source, quote);
    assert.equal(source.slice(blocks[0].start, blocks[0].end), quote);
    const multiline = `**first${newline}second**`;
    assert.equal(markdownRich.parseMarkdownRichBlocks(multiline, getSlowLineStarts(multiline))[0].source, multiline);
  }
  for (const source of ['```md\n> literal **text**\n```', '    > literal', '\\> literal']) {
    assert.equal(markdownRich.parseMarkdownRichBlocks(source, getSlowLineStarts(source)).length, 0, source);
  }

  const numberHighlightSamples = [
    ['asdf123 123asdf asdf123asdf 한글123끝', ['123', '123', '123', '123']],
    ['id_123', ['123']],
    ['123_id', ['123']],
    ['asdf 1e 23e41 ewqd', ['1', '23', '41']],
    ['v12.34kg -56.78 90', ['12.34', '56.78', '90']],
    ['#123456 word#123456 #123456, #1234567', ['123456', '123456', '1234567']],
    ['"word123" `word456` (word789)', ['123', '456', '789']],
    ['1. item23', ['23']],
    ['asdf1231523'.repeat(200), Array(200).fill('1231523')]
  ];
  const collectTokensOfType = (tokens, type) => tokens.flatMap((token) => [
    ...(token.type === type ? [token.text] : []),
    ...collectTokensOfType(token.children || [], type)
  ]);
  for (const formatId of ['plain', 'markdown']) {
    for (const [content, expectedNumbers] of numberHighlightSamples) {
      const rendered = documentFormats.parseDocumentForRender(content, {
        pathOrName: 'numbers', formatId, tabSize: 4, lineStartOffsets: [0]
      });
      const tokens = rendered.lines[0].tokens;
      assert.deepEqual(collectTokensOfType(tokens, 'number'), expectedNumbers,
        `${formatId} should highlight digit runs next to letters without changing other syntax`);
      assert.equal(flattenTokens(tokens), content, `${formatId} number highlighting must preserve source text`);
      if (content.startsWith('#123456 ')) {
        assert.deepEqual(collectTokensOfType(tokens, 'color'), ['#123456']);
      }
    }
  }
  const numberedComment = documentFormats.parseDocumentForRender('<!-- word123 #123456 --> word789', {
    pathOrName: 'numbers.md', formatId: 'markdown', tabSize: 4, lineStartOffsets: [0]
  });
  assert.deepEqual(collectTokensOfType(numberedComment.lines[0].tokens, 'number'), ['789']);
  assert.deepEqual(collectTokensOfType(numberedComment.lines[0].tokens, 'color'), ['#123456']);

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

  const commandTrace = [];
  const commandPipeline = new editorCommands.EditorCommandPipeline([
    { id: 'fallback', priority: 30, execute: () => { commandTrace.push('fallback'); return false; } },
    { id: 'first', priority: 10, execute: () => { commandTrace.push('first'); return false; } },
    { id: 'handled', priority: 20, execute: () => { commandTrace.push('handled'); return true; } }
  ]);
  assert.deepEqual(commandPipeline.getOrderedCommandIds(), ['first', 'handled', 'fallback']);
  assert.equal(commandPipeline.execute({ key: 'Enter' }), 'handled');
  assert.deepEqual(commandTrace, ['first', 'handled']);
  assert.throws(
    () => new editorCommands.EditorCommandPipeline([
      { id: 'duplicate', priority: 10, execute: () => false },
      { id: 'duplicate', priority: 20, execute: () => false }
    ]),
    /Duplicate editor command id/
  );
  assert.throws(
    () => new editorCommands.EditorCommandPipeline([
      { id: 'first', priority: 10, execute: () => false },
      { id: 'second', priority: 10, execute: () => false }
    ]),
    /Duplicate editor command priority/
  );

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

  const nestedDelimiterContent = '({["value"]})';
  const nestedDelimiterIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(nestedDelimiterContent);
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      1,
      nestedDelimiterIndex
    ),
    { opening: 0, closing: 12, kind: 'paren' }
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      2,
      nestedDelimiterIndex
    ),
    { opening: 1, closing: 11, kind: 'brace' }
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      3,
      nestedDelimiterIndex
    ),
    { opening: 2, closing: 10, kind: 'bracket' }
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      4,
      nestedDelimiterIndex
    ),
    { opening: 3, closing: 9, kind: 'quote' }
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      10,
      nestedDelimiterIndex
    ),
    { opening: 2, closing: 10, kind: 'bracket' },
    'the pair whose inner edge touches the caret wins between adjacent closers'
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      nestedDelimiterContent,
      nestedDelimiterContent.length,
      nestedDelimiterIndex
    ),
    { opening: 0, closing: 12, kind: 'paren' }
  );

  const bracketInsideQuoteContent = '"([{}])"';
  const bracketInsideQuoteIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(bracketInsideQuoteContent);
  assert.equal(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      bracketInsideQuoteContent,
      2,
      bracketInsideQuoteIndex
    ),
    null
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      bracketInsideQuoteContent,
      1,
      bracketInsideQuoteIndex
    ),
    { opening: 0, closing: 7, kind: 'quote' }
  );

  const escapedQuoteContent = '"a\\"b"';
  const escapedQuoteIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(escapedQuoteContent);
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      escapedQuoteContent,
      1,
      escapedQuoteIndex
    ),
    { opening: 0, closing: 5, kind: 'quote' }
  );
  assert.equal(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      escapedQuoteContent,
      4,
      escapedQuoteIndex
    ),
    null
  );

  const singleQuoteContent = "'quoted' and don't";
  const singleQuoteIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(singleQuoteContent);
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      singleQuoteContent,
      1,
      singleQuoteIndex
    ),
    { opening: 0, closing: 7, kind: 'quote' }
  );
  assert.equal(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      singleQuoteContent,
      singleQuoteContent.lastIndexOf("'") + 1,
      singleQuoteIndex
    ),
    null,
    'apostrophes inside words are not quote delimiters'
  );

  const adjacentSingleQuoteContent = "'first' then 'second'";
  const adjacentSingleQuoteIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(adjacentSingleQuoteContent);
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      adjacentSingleQuoteContent,
      1,
      adjacentSingleQuoteIndex
    ),
    { opening: 0, closing: 6, kind: 'quote' },
    'separate single-quoted values use their nearest valid closing quote'
  );
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      adjacentSingleQuoteContent,
      adjacentSingleQuoteContent.lastIndexOf("'"),
      adjacentSingleQuoteIndex
    ),
    {
      opening: adjacentSingleQuoteContent.indexOf("'", 7),
      closing: adjacentSingleQuoteContent.lastIndexOf("'"),
      kind: 'quote'
    }
  );

  const multilineDelimiterContent = '(\r\n  [value]\r\n)';
  const multilineDelimiterIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(multilineDelimiterContent);
  assert.deepEqual(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      multilineDelimiterContent,
      multilineDelimiterContent.length,
      multilineDelimiterIndex
    ),
    { opening: 0, closing: multilineDelimiterContent.length - 1, kind: 'paren' }
  );
  const mismatchedDelimiterContent = '([)]';
  const mismatchedDelimiterIndex = pairedDelimiterHighlighting.createPairedDelimiterIndex(mismatchedDelimiterContent);
  assert.equal(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      mismatchedDelimiterContent,
      0,
      mismatchedDelimiterIndex
    ),
    null
  );
  assert.equal(
    pairedDelimiterHighlighting.getPairedDelimiterHighlightAtCaret(
      mismatchedDelimiterContent,
      2,
      mismatchedDelimiterIndex
    ),
    null,
    'crossed bracket nesting does not leave a guessed inner pair'
  );

  assert.deepEqual(jsonPairEnter.getJsonPairEnterEdit('{}', 1, '\n', '    '), {
    content: '{\n    \n}',
    caret: 6
  });
  assert.deepEqual(jsonPairEnter.getJsonPairEnterEdit('[]', 1, '\r\n', '    '), {
    content: '[\r\n    \r\n]',
    caret: 7
  });
  const indentedPairSource = '  "items": [],';
  const indentedPairCaret = indentedPairSource.indexOf(']');
  assert.deepEqual(
    jsonPairEnter.getJsonPairEnterEdit(indentedPairSource, indentedPairCaret, '\r\n', '    '),
    {
      content: '  "items": [\r\n      \r\n  ],',
      caret: indentedPairCaret + '\r\n      '.length
    }
  );
  const nestedPairSource = '{"value": {}}';
  const nestedPairCaret = nestedPairSource.indexOf('}');
  assert.deepEqual(jsonPairEnter.getJsonPairEnterEdit(nestedPairSource, nestedPairCaret, '\n', '    '), {
    content: '{"value": {\n    \n}}',
    caret: nestedPairCaret + '\n    '.length
  });
  assert.equal(jsonPairEnter.getJsonPairEnterEdit('"{}"', 2, '\n', '    '), null);
  assert.equal(jsonPairEnter.getJsonPairEnterEdit('// {}', 4, '\n', '    '), null);
  assert.equal(jsonPairEnter.getJsonPairEnterEdit('/* [] */', 4, '\n', '    '), null);
  assert.equal(jsonPairEnter.getJsonPairEnterEdit('{]', 1, '\n', '    '), null);
  assert.equal(jsonPairEnter.getJsonPairEnterEdit('{ }', 1, '\n', '    '), null);

  const arrowSubstitutionSamples = [
    ['->', '→ '],
    ['-->', '→ '],
    ['<-', '← '],
    ['<--', '← '],
    ['<->', '↔ '],
    ['<-->', '↔ '],
    ['==>', '⇒ '],
    ['<==', '⇐ '],
    ['<=>', '⇔ '],
    ['<==>', '⇔ ']
  ];
  for (const [trigger, expected] of arrowSubstitutionSamples) {
    assert.deepEqual(arrowSubstitution.getArrowSubstitutionSpaceEdit(trigger, trigger.length), {
      content: expected,
      selection: { start: expected.length, end: expected.length }
    });
  }
  assert.deepEqual(arrowSubstitution.getArrowSubstitutionSpaceEdit('before\r\n->after', 10), {
    content: 'before\r\n→ after',
    selection: { start: 10, end: 10 }
  });
  assert.equal(arrowSubstitution.getArrowSubstitutionSpaceEdit('word->', 6), null);
  assert.equal(arrowSubstitution.getArrowSubstitutionSpaceEdit('=>', 2), null);
  assert.equal(arrowSubstitution.getArrowSubstitutionSpaceEdit('<=', 2), null);
  assert.equal(arrowSubstitution.getArrowSubstitutionSpaceEdit('>=', 2), null);

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

  assert.deepEqual(checkboxMarkers.getCheckboxMarkerAtStart('[] task'), {
    indent: '',
    marker: '[]',
    checked: false,
    spacing: ' ',
    prefix: '[] '
  });
  assert.deepEqual(checkboxMarkers.getCheckboxMarkerAtStart('[V] task'), {
    indent: '',
    marker: '[V]',
    checked: true,
    spacing: ' ',
    prefix: '[V] '
  });
  assert.deepEqual(checkboxMarkers.getCheckboxMarkerAtStart('    [] task'), {
    indent: '    ',
    marker: '[]',
    checked: false,
    spacing: ' ',
    prefix: '    [] '
  });
  assert.deepEqual(checkboxMarkers.getCheckboxMarkerAtStart('\t[V] task'), {
    indent: '\t',
    marker: '[V]',
    checked: true,
    spacing: ' ',
    prefix: '\t[V] '
  });
  for (const invalidCheckbox of ['[]', '[V]', '[]task', '[V]task', '[]\ttask', '    []task', '    []\ttask']) {
    assert.equal(checkboxMarkers.getCheckboxMarkerAtStart(invalidCheckbox), null);
  }

  const uncheckedCheckboxLine = '[] task';
  assert.deepEqual(
    checkboxMarkers.getCheckboxEnterEdit(uncheckedCheckboxLine, uncheckedCheckboxLine.length, '\n'),
    { text: '[] task\n[] ', caret: uncheckedCheckboxLine.length + 4 }
  );
  const checkedCheckboxLine = '[V] done';
  assert.deepEqual(
    checkboxMarkers.getCheckboxEnterEdit(checkedCheckboxLine, checkedCheckboxLine.length, '\r\n'),
    { text: '[V] done\r\n[] ', caret: checkedCheckboxLine.length + 5 }
  );
  const indentedCheckedCheckboxLine = '    [V] done';
  assert.deepEqual(
    checkboxMarkers.getCheckboxEnterEdit(
      indentedCheckedCheckboxLine,
      indentedCheckedCheckboxLine.length,
      '\r\n'
    ),
    {
      text: '    [V] done\r\n    [] ',
      caret: indentedCheckedCheckboxLine.length + '\r\n    [] '.length
    }
  );
  assert.deepEqual(
    checkboxMarkers.getCheckboxEnterEdit('[] beforeafter', '[] before'.length, '\n'),
    { text: '[] before\n[] after', caret: '[] before\n[] '.length }
  );
  assert.deepEqual(checkboxMarkers.getCheckboxEnterEdit('[] ', 3, '\n'), { text: '', caret: 0 });
  assert.deepEqual(checkboxMarkers.getCheckboxEnterEdit('[V] ', 4, '\n'), { text: '', caret: 0 });
  assert.deepEqual(
    checkboxMarkers.getCheckboxEnterEdit('    [] ', 7, '\n'),
    { text: '    ', caret: 4 }
  );
  assert.equal(checkboxMarkers.getCheckboxEnterEdit('[] task', 2, '\n'), null);

  assert.deepEqual(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('#', 1), {
    content: '# ',
    selection: { start: 2, end: 2 }
  });
  assert.deepEqual(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('##Title', 2), {
    content: '## Title',
    selection: { start: 3, end: 3 }
  });
  assert.deepEqual(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('#### Existing', 1), {
    content: '# Existing',
    selection: { start: 2, end: 2 }
  });
  assert.deepEqual(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('  ####### Existing', 4), {
    content: '  ## Existing',
    selection: { start: 5, end: 5 }
  });
  assert.deepEqual(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('before\r\n###Title\r\nafter', 11), {
    content: 'before\r\n### Title\r\nafter',
    selection: { start: 12, end: 12 }
  });
  assert.equal(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('#######Title', 7), null);
  assert.equal(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('text ##Title', 7), null);
  assert.equal(markdownHeadingEdit.getMarkdownHeadingSpaceEdit('    #Title', 5), null);
  assert.equal(markdownHeadingEdit.canInsertMarkdownHeadingReplacementMarker('## Existing', 0), true);
  assert.equal(markdownHeadingEdit.canInsertMarkdownHeadingReplacementMarker('### Existing', 1), true);
  assert.equal(markdownHeadingEdit.canInsertMarkdownHeadingReplacementMarker('###### Existing', 5), true);
  assert.equal(markdownHeadingEdit.canInsertMarkdownHeadingReplacementMarker('####### Existing', 6), false);
  assert.equal(markdownHeadingEdit.canInsertMarkdownHeadingReplacementMarker('Plain text', 0), false);

  const selectedMarkdownRender = documentFormats.parseDocumentForRender('## Heading', {
    pathOrName: 'Heading',
    formatId: 'markdown',
    tabSize: 4,
    lineStartOffsets: [0]
  });
  assert.equal(selectedMarkdownRender.format.id, 'markdown');
  assert.equal(selectedMarkdownRender.lines[0].headingLevel, 2);

  const checkboxContent = [
    '[] pending',
    '[V] complete',
    '[]',
    '[V]',
    '[]attached',
    '[V]attached',
    '[]\ttabbed',
    ' [] indented',
    ' []attached',
    '```',
    '[] code',
    '```'
  ].join('\r\n');
  const checkboxIndex = offsets.createTextOffsetIndex(checkboxContent);
  const checkboxRender = documentFormats.parseDocumentForRender(checkboxContent, {
    pathOrName: 'tasks.md',
    tabSize: 4,
    lineStartOffsets: checkboxIndex.lineStartOffsets,
    lineRange: { startLine: 0, endLine: checkboxIndex.lineStartOffsets.length - 1 }
  });
  assert.equal(checkboxRender.lines[0].tokens[0].type, 'checkbox');
  assert.equal(checkboxRender.lines[0].tokens[0].text, '[]');
  assert.equal(checkboxRender.lines[1].tokens[0].type, 'checkbox');
  assert.equal(checkboxRender.lines[1].tokens[0].text, '[V]');
  assert.equal(checkboxRender.lines[7].tokens[0].type, 'text');
  assert.equal(checkboxRender.lines[7].tokens[0].text, ' ');
  assert.equal(checkboxRender.lines[7].tokens[1].type, 'checkbox');
  assert.equal(checkboxRender.lines[7].tokens[1].text, '[]');
  for (const lineIndex of [2, 3, 4, 5, 6, 8]) {
    assert.equal(checkboxRender.lines[lineIndex].tokens.some((token) => token.type === 'checkbox'), false);
  }
  assert.equal(checkboxRender.lines[10].tokens[0].type, 'code');
  for (let index = 0; index < checkboxRender.lines.length; index += 1) {
    const sourceLine = checkboxContent.split(/\r?\n/u)[index];
    assert.equal(flattenTokens(checkboxRender.lines[index].tokens), sourceLine);
  }

  const plainCheckboxRender = documentFormats.parseDocumentForRender('[V] plain task', {
    pathOrName: 'tasks.txt',
    tabSize: 4,
    lineStartOffsets: [0]
  });
  assert.equal(plainCheckboxRender.format.id, 'plain');
  assert.equal(plainCheckboxRender.lines[0].tokens[0].type, 'checkbox');

  const attachedPlainCheckboxRender = documentFormats.parseDocumentForRender('[]plain task', {
    pathOrName: 'tasks.txt',
    tabSize: 4,
    lineStartOffsets: [0]
  });
  assert.equal(
    attachedPlainCheckboxRender.lines[0].tokens.some((token) => token.type === 'checkbox'),
    false
  );

  const jsonArrayRender = documentFormats.parseDocumentForRender('[]', {
    pathOrName: 'data.json',
    tabSize: 4,
    lineStartOffsets: [0]
  });
  assert.notEqual(jsonArrayRender.lines[0].tokens[0].type, 'checkbox');

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

  const csvInitialContent = documentFormats.getNewDocumentInitialContent('csv');
  const tsvInitialContent = documentFormats.getNewDocumentInitialContent('tsv');
  assert.equal(csvInitialContent, ',\n,');
  assert.equal(tsvInitialContent, '\t\n\t');
  assert.deepEqual(
    delimited.parseDelimitedTableWithinCellLimit(csvInitialContent, ',', budgets.MAX_INTERACTIVE_TABLE_CELLS)?.rows,
    [['', ''], ['', '']]
  );
  assert.deepEqual(
    delimited.parseDelimitedTableWithinCellLimit(tsvInitialContent, '\t', budgets.MAX_INTERACTIVE_TABLE_CELLS)?.rows,
    [['', ''], ['', '']]
  );
  assert.equal(documentFormats.getNewDocumentInitialContent('markdown'), '');
  assert.equal(documentFormats.defaultNewDocumentFormatId, 'markdown');
  assert.equal(documentFormats.isConfigurableDocumentFormatId('markdown'), true);
  assert.equal(documentFormats.isConfigurableDocumentFormatId('future-format'), false);
  assert.equal(documentFormats.getDocumentFormatById('markdown')?.defaultExtension, 'md');

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

  const selectedDuplication = editorDuplication.getEditorDuplicationEdit(
    'ABCD',
    { start: 1, end: 3 },
    '\n'
  );
  assert.deepEqual(selectedDuplication, {
    content: 'ABCBCD',
    selection: { start: 3, end: 5 }
  });

  const lfLineDuplication = editorDuplication.getEditorDuplicationEdit(
    'ABCD\nnext',
    { start: 2, end: 2 },
    '\n'
  );
  assert.deepEqual(lfLineDuplication, {
    content: 'ABCD\nABCD\nnext',
    selection: { start: 7, end: 7 }
  });

  const crlfLineDuplication = editorDuplication.getEditorDuplicationEdit(
    'ABCD\r\nnext',
    { start: 2, end: 2 },
    '\r\n'
  );
  assert.deepEqual(crlfLineDuplication, {
    content: 'ABCD\r\nABCD\r\nnext',
    selection: { start: 8, end: 8 }
  });

  const finalLineDuplication = editorDuplication.getEditorDuplicationEdit(
    'before\nABCD',
    { start: 9, end: 9 },
    '\n'
  );
  assert.deepEqual(finalLineDuplication, {
    content: 'before\nABCD\nABCD',
    selection: { start: 14, end: 14 }
  });

  const emptyLineDuplication = editorDuplication.getEditorDuplicationEdit(
    '',
    { start: 0, end: 0 },
    '\n'
  );
  assert.deepEqual(emptyLineDuplication, {
    content: '\n',
    selection: { start: 1, end: 1 }
  });

  const duplicationHistory = new editorUndo.EditorUndoHistory({
    content: 'ABCD',
    selection: { start: 1, end: 3 }
  });
  duplicationHistory.record(
    { content: 'ABCD', selection: { start: 1, end: 3 } },
    selectedDuplication,
    { change: textChanges.getTextChange('ABCD', selectedDuplication.content) }
  );
  assert.deepEqual(duplicationHistory.undo(selectedDuplication), {
    content: 'ABCD',
    selection: { start: 1, end: 3 }
  });
  assert.deepEqual(
    duplicationHistory.redo({ content: 'ABCD', selection: { start: 1, end: 3 } }),
    selectedDuplication
  );

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
    tabSize: 4,
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
    tabSize: 4,
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
  assert.equal(wrappedAfterSource.listLayouts[1].indentGuideCount, 0);
  const sourceAfterWrapped = editorLayout.getEditorLineLayout(modeCache, {
    ...modeOptions,
    wrapEnabled: false
  });
  assert.equal(sourceAfterWrapped.visitedLineCount, 0);
  assert.equal(sourceAfterWrapped.listLayouts.length, 0);

  // 표시 여백은 원문 위치나 연속 줄 구조를 바꾸지 않고 줄바꿈 폭에만 반영한다.
  for (const newline of ['\n', '\r\n']) {
    const insetContent = ['1. abcdef', '   abcdef', 'ordinary'].join(newline);
    const insetIndex = offsets.createTextOffsetIndex(insetContent);
    const insetLayout = editorLayout.getEditorLineLayout(editorLayout.createEditorLineLayoutCache(), {
      ...modeOptions,
      content: insetContent,
      lineStartOffsets: insetIndex.lineStartOffsets,
      wrapEnabled: true
    });
    for (const lineIndex of [0, 1]) {
      assert.equal(insetLayout.listLayouts[lineIndex].prefixLength, 3);
      assert.equal(insetLayout.listLayouts[lineIndex].visualIndentWidth, 4);
      assert.equal(insetLayout.listLayouts[lineIndex].prefixWidth, 3);
      assert.equal(insetLayout.getLineHeight(lineIndex), 40);
      assert.equal(insetLayout.listLayouts[lineIndex].indentGuideCount, 0);
    }
    assert.equal(insetLayout.listLayouts[1].ownerLineIndex, 0);
    assert.equal(insetLayout.listLayouts[2], null);
    assert.equal(insetLayout.getLineTop(2), 80);
  }

  assert.equal(editorScrollExtent.getEditorScrollHeight({
    baseBottomPadding: 8,
    clientHeight: 500,
    renderedContentHeight: 1_184,
    topPadding: 8
  }), 1_200);
  assert.equal(editorScrollExtent.getEditorScrollHeight({
    baseBottomPadding: 8,
    clientHeight: 500,
    renderedContentHeight: 200,
    topPadding: 8
  }), 500);
  assert.equal(editorScrollExtent.getRenderWheelScrollDelta({
    deltaMode: 0,
    deltaY: 240,
    lineHeight: 20,
    pageHeight: 500,
    shiftKey: false
  }), 240);
  assert.equal(editorScrollExtent.getRenderWheelScrollDelta({
    deltaMode: 1,
    deltaY: -3,
    lineHeight: 20,
    pageHeight: 500,
    shiftKey: false
  }), -60);
  assert.equal(editorScrollExtent.getRenderWheelScrollDelta({
    deltaMode: 2,
    deltaY: 1,
    lineHeight: 20,
    pageHeight: 500,
    shiftKey: false
  }), 500);
  assert.equal(editorScrollExtent.getRenderWheelScrollDelta({
    deltaMode: 0,
    deltaY: 240,
    lineHeight: 20,
    pageHeight: 500,
    shiftKey: true
  }), 0);

  const caretScheduler = createFakeRenderViewportScheduler();
  const caretSyncs = [];
  const caretController = new renderViewport.RenderViewportController({
    scheduler: caretScheduler.scheduler,
    resizeDebounceMs: 80,
    caretRevealSettleDelayMs: 200,
    isWrapSettlingEnabled: () => true,
    onViewportWidthChange() {},
    onViewportHeightChange() {},
    onWrapSettlingChange() {},
    onCaretSync: (revealCaret) => caretSyncs.push(revealCaret)
  });
  caretController.requestCaretReveal();
  caretController.syncCaretAfterLayout();
  assert.equal(caretScheduler.timeoutCount, 1);
  caretController.cancelCaretReveal();
  assert.equal(caretScheduler.timeoutCount, 0);
  caretScheduler.flushTimeouts();
  caretController.syncCaretAfterLayout();
  caretController.requestCaretReveal();
  caretScheduler.flushTimeouts();
  assert.deepEqual(caretSyncs, [true, true, false, true, true]);

  const viewportScheduler = createFakeRenderViewportScheduler();
  const viewportWidths = [];
  const viewportHeights = [];
  const wrapSettlingStates = [];
  const viewportController = new renderViewport.RenderViewportController({
    scheduler: viewportScheduler.scheduler,
    resizeDebounceMs: 80,
    caretRevealSettleDelayMs: 200,
    isWrapSettlingEnabled: () => true,
    onViewportWidthChange: (width) => viewportWidths.push(width),
    onViewportHeightChange: (height) => viewportHeights.push(height),
    onWrapSettlingChange: (isSettling) => wrapSettlingStates.push(isSettling),
    onCaretSync() {}
  });
  viewportController.connectViewport(500, 400);
  viewportController.observeViewportSize(510, 410);
  assert.deepEqual(wrapSettlingStates, []);
  viewportScheduler.flushTimeouts();
  assert.deepEqual(viewportWidths, [500, 510]);
  assert.equal(viewportScheduler.animationFrameCount, 1);
  viewportScheduler.flushAnimationFrame();
  viewportScheduler.flushAnimationFrame();
  viewportController.observeViewportSize(620, 420);
  viewportController.observeViewportSize(640, 430);
  assert.deepEqual(wrapSettlingStates, [true]);
  assert.equal(viewportScheduler.timeoutCount, 1);
  viewportScheduler.flushTimeouts();
  assert.deepEqual(viewportWidths, [500, 510, 640]);
  assert.deepEqual(viewportHeights, [400, 410, 420, 430]);
  viewportScheduler.flushAnimationFrame();
  assert.deepEqual(wrapSettlingStates, [true]);
  viewportScheduler.flushAnimationFrame();
  assert.deepEqual(wrapSettlingStates, [true, false]);
  viewportController.observeViewportSize(640, 435);
  assert.equal(viewportScheduler.timeoutCount, 0);
  assert.equal(viewportScheduler.animationFrameCount, 0);
  assert.deepEqual(viewportWidths, [500, 510, 640]);
  viewportController.observeViewportSize(700, 440);
  assert.deepEqual(wrapSettlingStates, [true, false, true]);
  viewportController.disconnectViewport();
  assert.equal(viewportScheduler.timeoutCount, 0);
  assert.equal(viewportScheduler.animationFrameCount, 0);
  assert.deepEqual(wrapSettlingStates, [true, false, true, false]);
  viewportScheduler.flushTimeouts();
  assert.deepEqual(viewportWidths, [500, 510, 640]);

  // 입력 시작 시에는 대기 중인 전체 입력창 폭을 즉시 확정한다.
  viewportController.connectViewport(700, 440);
  viewportController.observeViewportSize(760, 440);
  viewportController.flushPendingViewportWidth();
  assert.equal(viewportScheduler.timeoutCount, 0);
  assert.equal(viewportWidths.at(-1), 760);
  const flushedWidthCount = viewportWidths.length;
  viewportController.flushPendingViewportWidth();
  assert.equal(viewportWidths.length, flushedWidthCount);
  viewportController.dispose();
  viewportController.flushPendingViewportWidth();
  viewportScheduler.flushAnimationFrame();
  assert.equal(viewportWidths.length, flushedWidthCount);

  const nestedModeContent = '    1. item\n       continuation';
  const nestedModeIndex = offsets.createTextOffsetIndex(nestedModeContent);
  const nestedModeLayout = editorLayout.getEditorLineLayout(editorLayout.createEditorLineLayoutCache(), {
    ...modeOptions,
    content: nestedModeContent,
    lineStartOffsets: nestedModeIndex.lineStartOffsets,
    wrapEnabled: true
  });
  assert.ok(nestedModeLayout.listLayouts[1]);
  assert.equal(nestedModeLayout.listLayouts[1].indentGuideCount, 0);

  for (const newline of ['\n', '\r\n']) {
    for (const tabSize of [4, 8]) {
      const unit = ' '.repeat(tabSize);
      const guideContent = [
        `${unit}parent`, `${unit.repeat(2)}1. item`, `${unit.repeat(3)}a) nested`,
        `${unit.repeat(3)}   continuation`, '', '1. root', `${unit}A. nested`, '',
        `${unit.repeat(2)}normal`, `${unit.repeat(3)}- first`, `${unit}* outdent`,
        `${unit.repeat(3)}+ deeper`
      ].join(newline);
      const guideCache = editorLayout.createEditorLineLayoutCache();
      const guideOptions = {
        ...modeOptions, content: guideContent, tabSize, wrapEnabled: true,
        lineStartOffsets: offsets.createTextOffsetIndex(guideContent).lineStartOffsets
      };
      const guideLayout = editorLayout.getEditorLineLayout(guideCache, guideOptions);
      assert.deepEqual(guideLayout.listLayouts.map(line => line?.indentGuideCount ?? null),
        [null, 1, 1, 1, null, 0, 0, null, null, 2, 1, 1]);

      // 목록 원문은 그대로여도 앞선 일반 줄의 들여쓰기 변경을 캐시 종료 조건에 반영한다.
      const changedContent = guideContent.slice(unit.length);
      const changedGuideOptions = {
        ...guideOptions, content: changedContent,
        lineStartOffsets: offsets.createTextOffsetIndex(changedContent).lineStartOffsets,
        change: textChanges.getTextChange(guideContent, changedContent)
      };
      const changedGuideLayout = editorLayout.getEditorLineLayout(guideCache, changedGuideOptions);
      assert.deepEqual(changedGuideLayout.listLayouts.map(line => line?.indentGuideCount ?? null),
        [null, 0, 0, 0, null, 0, 0, null, null, 2, 1, 1]);
      const freshGuideLayout = editorLayout.getEditorLineLayout(editorLayout.createEditorLineLayoutCache(), changedGuideOptions);
      assert.deepEqual(changedGuideLayout.listLayouts, freshGuideLayout.listLayouts);
    }
  }


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
    tabSize: 4,
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

  const plainLines = Array.from({ length: 12_000 }, (_, index) => {
    if (index === 2 || index === 11_850) return '```';
    return `plain ${index}`;
  });
  assertCheckpointedRender(
    'large.txt',
    plainLines.join('\n'),
    { startLine: 11_700, endLine: 11_760 },
    'lineOriented'
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
      + `incremental layout/parser checkpoints, viewport lifecycle, prioritized editor commands, shared input diffs, bounded caches/undo, worker cancellation, `
      + `auto-pair right-context rules, paired-delimiter highlighting, JSON pair Enter, arrow substitutions, editor duplication, list-marker backspace, Markdown heading application, render checkboxes, new-table templates, `
      + `table copy-on-write, and softened content-weighted column widths with a 100px minimum.`
  );
} finally {
  await server.close();
}
