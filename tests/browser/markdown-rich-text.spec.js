import { expect, test } from '@playwright/test';
// @ts-expect-error 브라우저 테스트는 Node에서 실행되지만 앱에는 Node 타입을 포함하지 않는다.
import { readFileSync } from 'node:fs';

const sample = readFileSync(new URL('../../samples/ouroboros README.ko.md', import.meta.url), 'utf8');
const noOverlap = (/** @type {import('@playwright/test').Page} */ page) => page.locator('.backdrop-line').evaluateAll((elements) => {
  const rects = elements.map((el) => el.getBoundingClientRect()).sort((a, b) => a.top - b.top);
  return rects.slice(1).every((rect, index) => rect.top >= rects[index].bottom - 1);
});

test('Ouroboros HTML renders alignment, badges and disclosure while preserving its exact source', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(sample);
  await editor.press('Control+Home');
  await expect(page.locator('.rich-content p[align="right"]').first()).toHaveCSS('text-align', /right$/);
  await expect(page.locator('.rich-content strong').filter({ hasText: 'O U R O B O R O S' })).toBeVisible();
  await expect(page.locator('.rich-content img[alt="PyPI"]')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(editor).toHaveValue(sample.replaceAll('\r\n', '\n'));
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 650 });
    await expect.poll(() => noOverlap(page)).toBe(true);
  }
  await page.screenshot({ path: 'output/markdown-rich-sample.png' });
});

test('nested details expands Markdown, resizes paragraphs and source editing is undoable', async ({ page }) => {
  await page.goto('/');
  const text = '<details>\n<summary><b>Outer</b></summary>\n\n**Bold** and [link](https://example.com)\n\n<details>\n<summary>Inner</summary>\n\n```html\n</details>\n```\n\n</details>\n\n</details>\n\nAFTER';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(text);
  const block = page.locator('[data-markdown-rich="0"]');
  await expect(block.locator('details')).toHaveCount(2);
  await block.locator('summary').first().click({ modifiers: ['Control'] });
  await expect(block.locator('strong')).toHaveText('Bold');
  await block.locator('summary').nth(1).click({ modifiers: ['Control'] });
  await expect(block.locator('pre')).toHaveText('</details>\n');
  await expect.poll(() => noOverlap(page)).toBe(true);
  await block.locator('.edit-source').click({ force: true });
  await expect(page.locator('[data-markdown-rich]')).toHaveCount(0);
  await expect(editor).toHaveValue(text);
  expect(await editor.evaluate((el) => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return input.value.slice(input.selectionStart, input.selectionEnd);
  })).toBe(text.slice(0, text.indexOf('\n\nAFTER')));
  await page.keyboard.insertText('<p>Changed</p>');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(text);
});

test('common HTML formats work and active content cannot become app DOM', async ({ page }) => {
  await page.goto('/');
  const text = '<div align="center" style="position:fixed" id="editor-textarea" data-token-start="1">\n<kbd>Ctrl</kbd> <sup>2</sup> <sub>n</sub> <del>old</del> <ins>new</ins> <mark>mark</mark> <ruby>字<rt>ji</rt></ruby><br>\n<dl><dt>Term</dt><dd>Definition</dd></dl><table><tr><th>A</th><td>B</td></tr></table>\n<a href="jav&#x61;script:alert(1)" onclick="alert(2)">bad</a>\n<img src="javascript:alert(3)" onerror="alert(4)"><iframe srcdoc="bad"></iframe><script>window.BAD = 1</script><style>body{display:none}</style><svg onload="alert(5)"></svg><input autofocus>\n</div>';
  await page.getByTestId('editor-textarea').fill(text);
  const rich = page.locator('.rich-content');
  for (const tag of ['kbd', 'sup', 'sub', 'del', 'ins', 'mark', 'ruby', 'dl', 'table']) await expect(rich.locator(tag)).toHaveCount(1);
  await expect(rich.locator('script,style,iframe,svg,input,[style],[id],[data-token-start],[onclick],[onerror]')).toHaveCount(0);
  await expect(rich.locator('a')).not.toHaveAttribute('href');
  await expect(rich.locator('img')).not.toHaveAttribute('src');
  await expect(page.getByTestId('editor-textarea')).toHaveValue(text);
});

test('code and comments are not reinterpreted; image load changes share layout geometry', async ({ page }) => {
  await page.route('https://example.com/test.png', async (route) => {
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"><rect width="500" height="350" fill="green"/></svg>' });
  });
  await page.goto('/');
  const text = '```html\n<p>literal</p>\n```\n\n<!-- <details><summary>secret</summary></details> -->\n\n![Example](https://example.com/test.png)\n\nafter';
  await page.getByTestId('editor-textarea').fill(text);
  await expect(page.locator('.rich-content details')).toHaveCount(0);
  await expect(page.locator('.fenced-code-middle')).toContainText('<p>literal</p>');
  await expect.poll(() => page.locator('.rich-content img').evaluate((el) => /** @type {HTMLImageElement} */ (el).naturalHeight)).toBe(350);
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 650 });
    await expect.poll(() => noOverlap(page)).toBe(true);
    expect(await page.locator('.rich-content img').evaluate((el) => el.getBoundingClientRect().width <= (el.parentElement?.getBoundingClientRect().width ?? 0))).toBe(true);
  }
});

test('inline formatting keeps source offsets for pointer editing and undo', async ({ page }) => {
  await page.goto('/');
  const source = 'before **bold** *italic* ~~old~~ ***both*** after';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const rect = await page.locator('.hl-strong').first().evaluate((el) => {
    const node = [...el.querySelectorAll('span')].find((child) => child.textContent === 'bold');
    if (!node?.firstChild) throw new Error('Missing rendered bold text');
    const range = document.createRange();
    range.setStart(node.firstChild, 2); range.setEnd(node.firstChild, 2);
    const r = range.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 };
  });
  await page.mouse.click(rect.x, rect.y);
  await page.keyboard.insertText('X');
  await expect(editor).toHaveValue(source.replace('bold', 'boXld'));
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('reference links retain document context and heading links scroll within the document', async ({ page }) => {
  await page.goto('/');
  const source = '[site][home] and [go](#target)\n\n' + 'line\n'.repeat(100) + '\n## Target\n\n[home]: https://example.com';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  await editor.press('Control+Home');
  await expect(page.locator('.rich-content a').filter({ hasText: 'site' })).toHaveAttribute('href', 'https://example.com');
  await page.locator('.rich-content a').filter({ hasText: 'go' }).click({ modifiers: ['Control'] });
  await expect.poll(() => page.getByTestId('editor-viewport').evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
  await expect(editor).toHaveValue(source);
});

test('nested and quoted emphasis hides only valid markers and keeps editable source geometry', async ({ page }) => {
  await page.goto('/');
  const source = '# Emphasis\n\n**굵게 *중첩 기울임* 끝** and "*따옴표 안*"\n\n*기울임 **중첩 굵게** 끝* and ***둘 다***\n\na_b_c * spaced * ** spaced ** and ``*code* **code**``';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  const italic = page.locator('.hl-strong .hl-emphasis').filter({ hasText: '중첩 기울임' });
  await expect(italic).toHaveCSS('font-style', 'italic');
  await expect(italic).toHaveCSS('font-weight', '700');
  await expect(page.locator('.hl-emphasis .hl-strong').filter({ hasText: '중첩 굵게' })).toBeVisible();
  await expect(page.locator('.hl-string .hl-emphasis')).toContainText('따옴표 안');
  await expect(page.locator('.hl-code .hl-strong, .hl-code .hl-emphasis')).toHaveCount(0);
  await expect(page.locator('.hl-strong').filter({ hasText: ' spaced ' })).toHaveCount(0);
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 650 });
    await expect.poll(() => noOverlap(page)).toBe(true);
  }
  const point = await italic.evaluate((el) => {
    const text = [...el.querySelectorAll('span')].find((span) => span.textContent === '중첩 기울임');
    if (!text?.firstChild) throw new Error('Missing emphasis text');
    const range = document.createRange();
    range.setStart(text.firstChild, 2); range.collapse(true);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('추가');
  await expect(editor).toHaveValue(source.replace('중첩 기울임', '중첩추가 기울임'));
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('consecutive quotes form one nested block, wrap without overlap and edit the exact source', async ({ page }) => {
  await page.goto('/');
  const quote = '> 첫 인용 줄\n> 두 번째 **굵게**와 *기울임*\n>\n> > 중첩 인용\n>\n> - 첫 항목\n> - 둘째 항목\n>\n> ```md\n> **literal**\n> ```\n>\n> ' + '길게 이어지는 인용문입니다. '.repeat(12);
  const source = '# 인용문\n\n' + quote + '\n\n일반 문단\n\n> 별도 인용';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  await editor.press('Control+Home');
  const block = page.locator('[data-markdown-rich="2"]');
  await expect(block.locator('.rich-content > blockquote')).toHaveCount(1);
  await expect(block.locator('blockquote blockquote')).toHaveText('중첩 인용');
  await expect(block.locator('strong')).toHaveText('굵게');
  await expect(block.locator('em')).toHaveText('기울임');
  await expect(block.locator('li')).toHaveCount(2);
  await expect(block.locator('pre')).toHaveText('**literal**\n');
  await expect(block.locator('.rich-content > blockquote')).toHaveCSS('border-left-width', '3px');
  for (const width of [900, 460]) {
    await page.setViewportSize({ width, height: 850 });
    await expect.poll(() => noOverlap(page)).toBe(true);
  }
  await page.screenshot({ path: 'output/markdown-quotes.png' });
  await block.locator('.edit-source').click({ force: true });
  expect(await editor.evaluate((el) => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    return input.value.slice(input.selectionStart, input.selectionEnd);
  })).toBe(quote);
  await page.keyboard.insertText('> 수정한 인용문');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('lazy quote continuation and multiline emphasis use full paragraphs but code stays literal', async ({ page }) => {
  await page.goto('/');
  const source = '> 인용 시작\n이어지는 문장\n\n**여러 줄\n굵게**와 *여러 줄\n기울임*\n\n```md\n> **코드의 원문**\n```\n\n    > 들여쓴 코드\n\n\\> 일반 문장';
  const editor = page.getByTestId('editor-textarea');
  await editor.fill(source);
  await editor.press('Control+Home');
  await expect(page.locator('.rich-content blockquote')).toHaveCount(1);
  await expect(page.locator('.rich-content blockquote')).toContainText('이어지는 문장');
  await expect(page.locator('.rich-content strong')).toHaveText('여러 줄\n굵게');
  await expect(page.locator('.rich-content em')).toHaveText('여러 줄\n기울임');
  await expect(page.locator('.fenced-code-middle')).toContainText('> **코드의 원문**');
  await expect(editor).toHaveValue(source);
});
