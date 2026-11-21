import { expect, test } from '@playwright/test';

const source = '# Tables\n\nbefore\n\n| Name | Count |\n| :--- | ---: |\n| Apple | 2 |\n| Pear | 3 |\n\nafter\n\n| Other | Value |\n| --- | --- |\n| A | B |\n\nend';

test('Markdown tables reuse cell editing, preserve surrounding source and undo typing', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const blocks = page.locator('[data-markdown-table]');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.locator('.table-toolbar')).toHaveCount(0);
  await expect(blocks.first().locator('.table-editor')).toHaveCSS('border-width', '0px');
  const cell = blocks.first().locator('[data-table-row="1"][data-table-column="0"]');
  await cell.click();
  await expect(page.locator('.status-bar')).toContainText(/(?:행|Ln) 7,/);
  await cell.press('End');
  await cell.pressSequentially(' pie');
  await expect(editor).toHaveValue(source.replace('Apple', 'Apple pie'));
  await cell.press('Control+z');
  await expect(editor).toHaveValue(source);
  await page.keyboard.press('Control+y');
  await expect(editor).toHaveValue(source.replace('Apple', 'Apple pie'));
  await expect(cell).toBeFocused();
  await expect.poll(() => cell.evaluate((el) => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(9);

  await cell.fill(' leading | trailing ');
  await expect(cell).toHaveValue(' leading | trailing ');
  await expect(editor).toHaveValue(source.replace('Apple', '&#32;leading \\| trailing&#32;'));
  await cell.press('Tab');
  await expect(blocks.first().locator('[data-table-row="1"][data-table-column="1"]')).toBeFocused();
  await page.locator('.render-mode-toggle').click();
  await expect(blocks).toHaveCount(0);
  await expect(editor).toHaveValue(source.replace('Apple', '&#32;leading \\| trailing&#32;'));
});

test('Markdown column moves carry alignment and remain one undo step', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const block = page.locator('[data-markdown-table]').first();
  await block.locator('.column-drag-handle').first().press('Alt+ArrowRight');
  await expect(block.locator('[data-table-row="0"][data-table-column="0"]')).toHaveValue('Count');
  await expect(block.locator('[data-table-row="1"][data-table-column="0"]')).toHaveCSS('text-align', 'right');
  await expect(editor).toHaveValue(source.replace(
    '| Name | Count |\n| :--- | ---: |\n| Apple | 2 |\n| Pear | 3 |',
    '| Count | Name |\n| ---: | :--- |\n| 2 | Apple |\n| 3 | Pear |'
  ));
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await block.locator('.row-insert-after button').click({ force: true });
  await expect(block.locator('tbody tr')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('Markdown block heights keep paragraphs aligned after resize and edits', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 650 });
    const overlap = () => page.locator('.backdrop-line').evaluateAll((elements) => {
      const rects = elements.map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
      return rects.slice(1).some((rect, index) => rect.top < rects[index].bottom - 1);
    });
    await expect.poll(overlap).toBe(false);
    const cell = page.locator('[data-markdown-table]').first().locator('[data-table-row="1"][data-table-column="0"]');
    await cell.fill('first\nsecond\nthird');
    await expect(cell).toHaveValue('first\nsecond\nthird');
    await expect.poll(overlap).toBe(false);
    await cell.press('Escape');
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('paragraph');
    await expect(editor).toHaveValue(source.replace('Apple', 'first<br>second<br>third').replace('\n\nafter', '\nparagraph\nafter'));
    await editor.fill(source);
  }
});

test('Markdown table detection excludes code, comments, invalid rows and over-budget tables', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const valid = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const text = `\`\`\`md\n${valid}\n\`\`\`\n\n~~~\n${valid}\n~~~\n\n<!--\n${valid}\n-->\n\n| A | B |\n| --- |\n\n${valid}\n\nend`;
  await editor.fill(text);
  await expect(page.locator('[data-markdown-table]')).toHaveCount(1);
  await expect(editor).toHaveValue(text);
  await editor.fill('| A | B |\n| --- | --- |\n' + '| 1 | 2 |\n'.repeat(1000));
  await expect(page.locator('[data-markdown-table]')).toHaveCount(0);
});

test('a long table flows with the document and its end remains reachable', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('before\n\n| A | B |\n| --- | --- |\n' + '| 1 | 2 |\n'.repeat(150) + '\nEND_MARKER');
  const block = page.locator('[data-markdown-table]');
  await expect(block).toBeVisible();
  await expect.poll(() => block.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(4500);
  const scroll = block.locator('.table-scroll-region');
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  const viewport = page.getByTestId('editor-viewport');
  await editor.press('Control+Home');
  await block.locator('[data-table-row="1"][data-table-column="0"]').hover();
  const beforeScroll = await viewport.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(beforeScroll);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.backdrop-line').filter({ hasText: 'END_MARKER' })).toBeVisible();
});

test('table keyboard boundaries enter paragraphs and source selections include the table', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const tableSource = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  await editor.fill(tableSource);
  const block = page.locator('[data-markdown-table]');
  await block.locator('[data-table-row="1"][data-table-column="1"]').press('Tab');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(`${tableSource}\n`);
  await page.keyboard.insertText('after');
  await expect(editor).toHaveValue(`${tableSource}\nafter`);
  await editor.press('Control+Home');
  await expect(editor).toBeFocused();
  await editor.press('ArrowRight');
  await expect(block.locator('[data-table-row="0"][data-table-column="0"]')).toBeFocused();
  await block.locator('[data-table-row="0"][data-table-column="0"]').press('Shift+Tab');
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('before');
  await expect(editor).toHaveValue(`before\n${tableSource}\nafter`);
  await editor.press('Control+a');
  await expect(block).toHaveClass(/table-source-selected/);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(`before\n${tableSource}\nafter`);
});

test('표 셀을 넘는 방향키와 역방향 선택이 같은 원문 기준점을 보존한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const tableSource = '| A | B |\n| --- | --- |\n| cat | dog |';
  const source = `before\n\n${tableSource}\n\nafter`;
  const tableStart = source.indexOf(tableSource);
  const tableEnd = tableStart + tableSource.length;
  const bStart = source.indexOf('B');
  const aEnd = source.indexOf('A') + 1;
  const dogEnd = source.indexOf('dog') + 3;
  const range = () => editor.evaluate(el => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return [input.selectionStart, input.selectionEnd, input.selectionDirection];
  });
  await editor.fill(source);
  const table = page.locator('[data-markdown-table]');
  const firstCell = table.locator('[data-table-row="0"][data-table-column="0"]');
  const secondCell = table.locator('[data-table-row="0"][data-table-column="1"]');
  const bottomCell = table.locator('[data-table-row="1"][data-table-column="1"]');
  await secondCell.press('Home');
  await secondCell.press('ArrowLeft');
  await expect(firstCell).toBeFocused();
  await expect.poll(range).toEqual([aEnd, aEnd, 'forward']);
  await page.keyboard.press('ArrowRight');
  await expect(secondCell).toBeFocused();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(editor).toBeFocused();
  await expect.poll(range).toEqual([aEnd, bStart, 'backward']);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(secondCell).toBeFocused();
  await expect.poll(range).toEqual([bStart, bStart, 'forward']);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(range).toEqual([bStart, bStart + 1, 'forward']);
  await page.keyboard.press('ArrowDown');
  await expect(bottomCell).toBeFocused();

  await bottomCell.press('End');
  await bottomCell.press('Shift+ArrowDown');
  await expect(editor).toBeFocused();
  await expect.poll(range).toEqual([dogEnd, tableEnd, 'forward']);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(range).toEqual([dogEnd, tableEnd + 1, 'forward']);
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(range).toEqual([dogEnd, tableEnd, 'forward']);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(bottomCell).toBeFocused();
  await expect.poll(range).toEqual([dogEnd, dogEnd, 'forward']);
  await expect(editor).toHaveValue(source);
});

test('표만 정확히 선택하고 문서 경계에서 방향키로 빈 줄을 추가하지 않는다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const tableSource = '| A | B |\n| --- | --- |\n| cat | dog |';
  const table = page.locator('[data-markdown-table]');
  const range = () => editor.evaluate(el => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return [input.selectionStart, input.selectionEnd, input.selectionDirection];
  });
  const surrounding = `before\n\n${tableSource}\n\nafter`;
  await editor.fill(surrounding);
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  const tableStart = surrounding.indexOf(tableSource);
  const tableEnd = tableStart + tableSource.length;
  await expect.poll(range).toEqual([tableStart, tableStart, 'forward']);
  await editor.press('Shift+ArrowRight');
  await expect(table).not.toHaveClass(/table-source-selected/);
  await editor.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => Array.from(CSS.highlights.get('render-selection') ?? [], range => range.toString()))).toContain('A');
  await editor.press('Shift+ArrowDown');
  await expect(table).not.toHaveClass(/table-source-selected/);
  await editor.press('Shift+ArrowDown');
  await expect.poll(range).toEqual([tableStart, tableEnd, 'forward']);
  await expect(table).toHaveClass(/table-source-selected/);
  await editor.press('Delete');
  await expect(editor).toHaveValue('before\n\n\n\nafter');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(surrounding);
  await expect(table).toHaveClass(/table-source-selected/);

  await editor.fill(tableSource);
  await editor.press('Control+Home');
  await editor.press('ArrowRight');
  const firstCell = table.locator('[data-table-row="0"][data-table-column="0"]');
  await expect(firstCell).toBeFocused();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(range).toEqual([0, 2, 'backward']);
  await page.keyboard.press('ArrowLeft');
  for (const key of ['ArrowUp', 'ArrowLeft', 'Shift+ArrowUp', 'Shift+ArrowLeft']) await page.keyboard.press(key);
  await expect.poll(range).toEqual([0, 0, 'forward']);
  await editor.press('Control+End');
  const bottomCell = table.locator('[data-table-row="1"][data-table-column="1"]');
  await editor.press('ArrowLeft');
  await expect(bottomCell).toBeFocused();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(range).toEqual([tableSource.indexOf('dog') + 3, tableSource.length, 'forward']);
  await page.keyboard.press('ArrowRight');
  for (const key of ['ArrowDown', 'ArrowRight', 'Shift+ArrowDown', 'Shift+ArrowRight']) await page.keyboard.press(key);
  await expect.poll(range).toEqual([tableSource.length, tableSource.length, 'forward']);
  await expect(editor).toHaveValue(tableSource);
  await editor.press('Control+z');
  await expect(editor).toHaveValue(surrounding);
});

test('긴 표를 선택할 때 화면이 이동점을 따라가고 외곽 파이프 없는 표도 끝까지 선택된다', async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 430 });
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const viewport = page.getByTestId('editor-viewport');
  const source = ['Head | Value', '--- | ---', ...Array.from({ length: 24 }, (_, row) => `${row} | cell`)].join('\n');
  await editor.fill(source);
  await editor.press('Control+Home');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => editor.evaluate(el => (/** @type {HTMLTextAreaElement} */ (el)).selectionEnd)).toBe(1);
  for (let step = 0; step < 28; step++) await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => editor.evaluate(el => (/** @type {HTMLTextAreaElement} */ (el)).selectionEnd)).toBe(source.length);
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(200);
  await expect(page.locator('[data-markdown-table]')).toHaveClass(/table-source-selected/);
  await expect(editor).toHaveValue(source);
});

test('복사한 표의 바깥 셀을 지우거나 바꾸어도 같은 열이 유지된다', async ({ page }) => {
  await page.goto('/');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const editor = page.getByTestId('editor-textarea');
  const source = 'A|B\n---|---\none|two';
  await editor.fill(source);
  await editor.press('Control+a');
  await editor.press('Control+c');
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(source);
  await editor.fill('before\n\n');
  await editor.press('Control+End');
  await editor.press('Control+v');
  const base = 'before\n\n' + source;
  await expect(editor).toHaveValue(base);
  const table = page.locator('[data-markdown-table]');
  const cell = table.locator('[data-table-row="0"][data-table-column="0"]');
  await cell.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await expect(cell).toBeFocused();
  await expect(cell).toHaveValue('');
  await expect(table.locator('[data-table-row="0"][data-table-column="1"]')).toHaveValue('B');
  await expect(editor).toHaveValue(base.replace('A|B', '||B'));
  await page.keyboard.insertText('# New');
  await expect(cell).toHaveValue('# New');
  await expect(editor).toHaveValue(base.replace('A|B', '|# New|B'));
  await page.keyboard.press('Control+z');
  await expect(cell).toHaveValue('');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(base);

  const last = table.locator('[data-table-row="1"][data-table-column="1"]');
  await last.click();
  await last.press('Backspace');
  await expect(last).toHaveValue('');
  await expect(editor).toHaveValue(base.replace('one|two', 'one||'));

  await cell.click();
  await page.keyboard.insertText('\\');
  await expect(cell).toHaveValue('\\');
  await expect(table.locator('[data-table-row="0"][data-table-column="1"]')).toHaveValue('B');
});

test('a table drag is cancelled when its tab is replaced', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('editor-textarea').fill(source);
  const handle = page.locator('[data-markdown-table]').first().locator('.row-drag-handle').nth(1);
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 35);
  await page.keyboard.press('Control+n');
  await page.mouse.up();
  await expect(page.getByTestId('editor-textarea')).toHaveValue('');
  await expect(page.locator('.table-drag-preview')).toHaveCount(0);
  await page.getByRole('tab').first().click();
  await expect(page.getByTestId('editor-textarea')).toHaveValue(source);
});

for (const format of ['CSV', 'TSV']) {
  test(`${format} keeps the shared cell editor and original delimiter`, async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-document-format-trigger').click();
    await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    const table = page.locator('.table-editor');
    await expect(table).toBeVisible();
    await expect(table.locator('.table-toolbar')).toBeVisible();
    await table.locator('[data-table-row="0"][data-table-column="0"]').fill('Name');
    await table.locator('[data-table-row="1"][data-table-column="0"]').fill('a,b');
    await table.locator('[data-table-row="1"][data-table-column="1"]').fill('2');
    await page.keyboard.press('Control+z');
    await expect(table.locator('[data-table-row="1"][data-table-column="1"]')).toHaveValue('');
    await page.keyboard.press('Control+y');
    await expect(table.locator('[data-table-row="1"][data-table-column="1"]')).toHaveValue('2');
    await page.locator('.render-mode-toggle').click();
    await expect(page.getByTestId('editor-textarea')).toHaveValue(format === 'CSV' ? 'Name,\n"a,b",2' : 'Name\t\na,b\t2');
  });
}

for (const mode of ['render-off', 'edit-off']) {
  test(`Markdown table respects ${mode}`, async ({ page }) => {
    await page.addInitScript((mode) => localStorage.setItem('text-pad.settings', JSON.stringify({
      format: 'text-pad-settings', schemaVersion: 1,
      settings: { render: { formats: { features: { markdown: { render: mode !== 'render-off', edit: mode !== 'edit-off' } } } } }
    })), mode);
    await page.goto('/');
    await page.getByTestId('editor-textarea').fill(source);
    if (mode === 'render-off') {
      await expect(page.locator('[data-markdown-table]')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-markdown-table]')).toHaveCount(2);
      await expect(page.locator('[data-markdown-table] .table-cell-editor').first()).toHaveAttribute('readonly', '');
      await expect(page.locator('[data-markdown-table] .edge-action-button')).toHaveCount(0);
    }
    await expect(page.getByTestId('editor-textarea')).toHaveValue(source);
  });
}
