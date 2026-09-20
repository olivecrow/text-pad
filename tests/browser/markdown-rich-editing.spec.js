import { expect, test } from '@playwright/test';
// @ts-expect-error 브라우저 검사 실행기의 Node 모듈이다.
import { readFileSync } from 'node:fs';

/** @param {import('@playwright/test').Page} page @param {string} text @param {number} offset */
async function point(page, text, offset) {
  return page.locator('[data-rich-offsets]').filter({ hasText: text }).evaluateAll((elements, args) => {
    const el = elements.find(el => el.textContent === args.text);
    if (!el?.firstChild) throw new Error(`Missing mapped text: ${args.text}`);
    const range = document.createRange();
    range.setStart(el.firstChild, args.offset); range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  }, { text, offset });
}

test('HTML, quotes, link labels and repeated words edit the clicked source position without leaving render mode', async ({ page }) => {
  await page.goto('/');
  const source = '<p title="같은 말"><strong>같은 말</strong> <em>같은 말</em> &amp; 끝</p>\n\n> 첫 줄 **굵은 말**\n> 둘째 줄\n\n앞 [같은 말](https://example.com/같은말) 뒤';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const targets = [
    { selector: '.rich-content em [data-rich-offsets]', text: '같은 말', expected: source.indexOf('<em>') + 4 + 2 },
    { selector: '.rich-content blockquote strong [data-rich-offsets]', text: '굵은 말', expected: source.indexOf('굵은 말') + 2 },
    { selector: '.rich-content a [data-rich-offsets]', text: '같은 말', expected: source.indexOf('[같은 말]') + 1 + 2 }
  ];
  for (const target of targets) {
    const p = await page.locator(target.selector).evaluate(el => {
      if (!el.firstChild) throw new Error('Missing text node');
      const r = document.createRange(); r.setStart(el.firstChild, 2); r.collapse(true);
      const b = r.getBoundingClientRect(); return { x: b.x, y: b.y + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(target.expected);
    await expect(page.locator('.steady-editor-caret')).toBeVisible();
    await page.keyboard.insertText('추가');
    await expect(editor).toHaveValue(source.slice(0, target.expected) + '추가' + source.slice(target.expected));
    await expect(page.locator('.render-rich-block')).toHaveCount(3);
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveValue(source);
    await page.keyboard.press('Control+y');
    await expect(editor).toHaveValue(source.slice(0, target.expected) + '추가' + source.slice(target.expected));
    await page.keyboard.press('Control+z');
  }
});

test('HTML entities and tag boundaries support deletion, arrows, selection and replacement', async ({ page }) => {
  await page.goto('/');
  const source = '<p><b>abc</b><i>def</i> &amp; 😀 끝</p>';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  let p = await point(page, 'def', 0);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue(source.replace('abc', 'ab'));
  await page.keyboard.press('Control+z');
  p = await point(page, 'def', 1);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Home');
  await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(source.indexOf('abc'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.insertText('한글');
  await expect(editor).toHaveValue(source.replace('abc', 'a한글'));
  await page.keyboard.press('Control+z');
  p = await point(page, ' & 😀 끝', 2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue(source.replace('&amp;', ''));
});

test('Ouroboros centered HTML, disclosure contents and wrapping retain editable source coordinates', async ({ page }) => {
  await page.goto('/');
  const source = readFileSync(new URL('../../samples/ouroboros README.ko.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  await editor.press('Control+Home');
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 850 });
    const label = '프롬프트를 멈추세요. 명세를 시작하세요.';
    await page.locator('[data-rich-offsets]').filter({ hasText: label }).scrollIntoViewIfNeeded();
    const p = await point(page, label, 5);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => editor.evaluate(el => {
      const input = /** @type {HTMLTextAreaElement} */ (el);
      return [input.selectionStart, input.selectionEnd];
    })).toEqual([source.indexOf(label) + 5, source.indexOf(label) + 5]);
    await page.keyboard.insertText('수정');
    await expect(editor).toHaveValue(source.replace(label, label.slice(0, 5) + '수정' + label.slice(5)));
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveValue(source);
  }
  // 접기는 Ctrl+클릭으로 조작하고 제목 본문은 일반 클릭으로 편집한다.
  await editor.fill('<details><summary>설치 방법</summary>\n\n**안쪽 문장**과 [링크](https://example.com)\n\n</details>');
  await page.locator('summary').click({ modifiers: ['Control'] });
  await expect(page.locator('details')).toHaveAttribute('open');
  const p = await point(page, '안쪽 문장', 2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.insertText('추가');
  await expect(editor).toHaveValue('<details><summary>설치 방법</summary>\n\n**안쪽추가 문장**과 [링크](https://example.com)\n\n</details>');
  await expect(page.locator('details')).toHaveAttribute('open');
  await page.screenshot({ path: 'output/markdown-rich-editing.png' });
});

test('rich text dragging, visible line breaks and Korean composition use the original editor history', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '<p><strong>앞부분 뒷부분</strong></p>';
  await editor.fill(source);
  let a = await point(page, '앞부분 뒷부분', 1);
  let b = await point(page, '앞부분 뒷부분', 3);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect.poll(() => editor.evaluate(el => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return input.value.slice(input.selectionStart, input.selectionEnd);
  })).toBe('부분');
  await page.mouse.up();
  await page.keyboard.insertText('수정');
  await expect(editor).toHaveValue(source.replace('앞부분', '앞수정'));
  await page.keyboard.press('Control+z');
  a = await point(page, '앞부분 뒷부분', 4);
  await page.mouse.click(a.x, a.y); await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(source.replace('앞부분 ', '앞부분 <br>'));
  await expect(page.locator('.rich-content br')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue(source);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.insertText', { text: '한글' });
  await expect(editor).toHaveValue(source.replace('앞부분 ', '앞부분 한글'));
  await expect(page.locator('.render-rich-block')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
  await session.detach();
  await editor.fill('> 앞부분 뒷부분');
  a = await point(page, '앞부분 뒷부분', 4);
  await page.mouse.click(a.x, a.y); await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('> 앞부분   \n> 뒷부분');
  await expect(page.locator('.rich-content br')).toHaveCount(1);
  const quotedTable = '> | > | second |\n> | --- | --- |\n> | value | end |';
  await editor.fill(quotedTable);
  a = await point(page, '>', 1);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.insertText('수정');
  await expect(editor).toHaveValue(quotedTable.replace('| > |', '| >수정 |'));
});
