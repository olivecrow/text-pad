import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {string} text @param {number} offset */
async function clickText(page, text, offset) {
  const point = await page.locator('[data-rich-offsets]').evaluateAll((elements, args) => {
    const el = elements.find(el => el.textContent === args.text);
    if (!el?.firstChild) throw new Error(`Missing mapped text: ${args.text}`);
    const r = document.createRange(); r.setStart(el.firstChild, args.offset); r.collapse(true);
    const b = r.getBoundingClientRect(); return { x: b.x, y: b.y + b.height / 2 };
  }, { text, offset });
  await page.mouse.click(point.x, point.y);
}

test('cross-format deletion, replacement, paste and Undo preserve wrappers', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '<p><b>abc</b><i>def</i></p>';
  for (const operation of ['Backspace', 'type', 'paste']) {
    await editor.fill(source);
    await clickText(page, 'abc', 1);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
    if (operation === 'Backspace') await page.keyboard.press('Backspace');
    else if (operation === 'type') await page.keyboard.insertText('한글');
    else {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('한글'));
      await page.keyboard.press('Control+v');
    }
    await expect(editor).toHaveValue(`<p><b>a${operation === 'Backspace' ? '' : '한글'}</b><i>f</i></p>`);
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveValue(source);
  }
  await editor.press('Control+a'); await editor.press('Backspace');
  await expect(editor).toHaveValue('');
});

test('empty wrappers stay literal and become formatted only when content exists', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('<b></b>');
  await expect(page.locator('.rich-content')).toHaveText('<b></b>');
  await clickText(page, '<b>', 3);
  await page.keyboard.insertText('가');
  await expect(editor).toHaveValue('<b>가</b>');
  await expect(page.locator('.rich-content b')).toHaveText('가');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.rich-content')).toHaveText('<b></b>');
  await page.keyboard.insertText(' ');
  await expect(editor).toHaveValue('<b> </b>');
  await expect(page.locator('.rich-content b')).toHaveCount(1);
  await expect(page.locator('.rich-content')).not.toContainText('<b>');
  await editor.fill('<p><b></b><i></i></p>');
  await expect(page.locator('.rich-content')).toHaveText('<p><b></b><i></i></p>');
  await editor.fill('<strong>');
  await expect(page.locator('.rich-content')).toHaveText('<strong>');
  await editor.fill('[](https://example.com)');
  await expect(page.locator('.rich-content')).toHaveText('[](https://example.com)');
  await clickText(page, '[](https://example.com)', 1);
  await page.keyboard.insertText('링크');
  await expect(page.locator('.rich-content a')).toHaveText('링크');
});

test('menu Delete uses the same visible character boundary as the keyboard', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '<p><b>abc</b><i>def</i></p>';
  await editor.fill(source);
  await clickText(page, 'abc', 3);
  await page.getByRole('button', { name: /^(편집\(E\)|Edit \(E\))$/ }).click();
  await page.getByRole('button', { name: /^(삭제|Delete) Del$/ }).click();
  await expect(editor).toHaveValue('<p><b>abc</b><i>ef</i></p>');
  await editor.press('Control+z'); await expect(editor).toHaveValue(source);
});

test('a Korean composition across formatting boundaries is one reversible edit', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '<p><b>abc</b><i>def</i></p>';
  await editor.fill(source);
  await clickText(page, 'abc', 1);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.insertText', { text: '한글' });
  await expect(editor).toHaveValue('<p><b>a한글</b><i>f</i></p>');
  await editor.press('Control+z'); await expect(editor).toHaveValue(source);
  await editor.press('Control+y'); await expect(editor).toHaveValue('<p><b>a한글</b><i>f</i></p>');
  await session.detach();
});

test('visible line breaks can be deleted without changing surrounding formatting', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const source of ['**first**\nsecond', '[first](https://example.com)\nsecond']) {
    await editor.fill(source);
    await clickText(page, 'second', 0);
    await editor.press('Backspace');
    await expect(editor).toHaveValue(source.replace('\n', ''));
    await editor.press('Control+z'); await expect(editor).toHaveValue(source);
  }
});

test('pair deletion has the same meaning in plain, HTML and quoted text', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const source of ['a b', '<p>a b</p>', '> a b']) {
    await editor.fill(source);
    await editor.press('Home'); await editor.press('ArrowRight');
    await editor.press('(');
    await expect(editor).toHaveValue(source.replace('a b', 'a() b'));
    await editor.press('Backspace');
    await expect(editor).toHaveValue(source);
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source.replace('a b', 'a() b'));
  }
});

test('table paste and a long Korean composition have separate atomic Undo groups', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '| Name | Value |\n| --- | --- |\n| first | alpha |';
  await editor.fill(source);
  const cell = page.locator('[data-table-row="1"][data-table-column="1"]');
  await cell.click(); await cell.press('End');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('ZZ'));
  await cell.press('x'); await cell.press('Control+v');
  await expect(cell).toHaveValue('alphaxZZ');
  await cell.press('Control+z'); await expect(cell).toHaveValue('alphax');
  await cell.press('Control+z'); await expect(cell).toHaveValue('alpha');
  await cell.press('End');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
  // 기록 병합 제한인 1초를 실제 조합 상태에서 넘긴다.
  await page.waitForTimeout(1100);
  await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.insertText', { text: '한글' });
  await expect(cell).toHaveValue('alpha한글');
  await cell.press('Control+z'); await expect(cell).toHaveValue('alpha');
  await cell.press('Control+y'); await expect(cell).toHaveValue('alpha한글');
  await session.detach();
});

for (const customized of [false, true]) test(`plain and linked Markdown headings share ${customized ? 'custom' : 'default'} typography`, async ({ page }) => {
  if (customized) await page.addInitScript(() => localStorage.setItem('text-pad.settings', JSON.stringify({
    format: 'text-pad-settings', schemaVersion: 1,
    settings: { render: { formats: { markdown: {
      hideHeadingMarkers: false, showHeadingDividers: false, headings: { 1: { sizePercent: 120, fontWeight: '400' } }
    } } } }
  })));
  await page.goto('/');
  await page.getByTestId('editor-textarea').fill('# Alpha\n\n# [Beta](https://example.com)');
  const plain = page.locator('.markdown-heading-line .hl-text');
  const rich = page.locator('.rich-content h1');
  const style = await plain.evaluate(el => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }));
  await expect.poll(() => rich.evaluate(el => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }))).toEqual(style);
  await expect(rich).toHaveCSS('box-shadow', await page.locator('.markdown-heading-line').evaluate(el => getComputedStyle(el).boxShadow));
  await expect(rich).toHaveText(customized ? '# Beta' : 'Beta');
  if (customized) {
    // 표식을 표시한 경우 해당 글자도 일반 원문처럼 지울 수 있다.
    await clickText(page, '# ', 1);
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('editor-textarea')).toHaveValue('# Alpha\n\n [Beta](https://example.com)');
  }
});
