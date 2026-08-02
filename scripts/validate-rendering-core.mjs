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

  console.log(
    `Validated render core: CRLF offsets, logarithmic hit testing (${rectCalls} reads), `
      + `XML range cache (${xmlParseDuration.toFixed(1)}ms), list-marker backspace, and table copy-on-write.`
  );
} finally {
  await server.close();
}
