import { expect, test } from '@playwright/test';

for (const format of ['Text', 'Markdown']) {
  test(`${format}: 새 글머리와 반복 공백 입력`, async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-document-format-trigger').click();
    await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    const editor = page.getByTestId('editor-textarea');
    await editor.fill('- first');
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.press('Space');
    await editor.press('Space');
    await page.keyboard.insertText('second');
    await expect(editor).toHaveValue('- first\n-   second');
    await editor.press('Enter');
    await expect(editor).toHaveValue('- first\n-   second\n- ');
    await page.keyboard.insertText('third');
    await expect(editor).toHaveValue('- first\n-   second\n- third');
  });
}

test('Markdown 일반 문단 끝의 연속 공백 뒤에 입력을 이어갈 수 있다', async ({ page }) => {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^Markdown$/ }).click();
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('hello');
  await editor.press('Control+End');
  for (let n = 1; n <= 3; n++) {
    await editor.press('Space');
    await expect(editor).toHaveValue('hello' + ' '.repeat(n));
    await expect.poll(() => editor.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(5 + n);
  }
  await page.keyboard.insertText('world');
  await expect(editor).toHaveValue('hello   world');
});

test('링크가 있는 Markdown 문단 끝에서 스페이스만큼 커서가 전진한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^Markdown$/ }).click();
  const editor = page.getByTestId('editor-textarea');
  const source = '연락처 user@example.com';
  await editor.fill(source);
  await expect(page.locator('.rich-content').getByRole('link')).toBeVisible();
  await editor.press('Control+End');
  const caret = page.locator('.steady-editor-caret');
  for (let n = 1; n <= 3; n++) {
    const before = await caret.boundingBox();
    expect(before).not.toBeNull();
    await editor.press('Space');
    await expect(editor).toHaveValue(source + ' '.repeat(n));
    await expect.poll(() => editor.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(source.length + n);
    await expect.poll(async () => (await caret.boundingBox())?.x ?? 0).toBeGreaterThan(before?.x ?? 0);
  }
  await page.keyboard.insertText('다음');
  await expect(editor).toHaveValue(source + '   다음');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(source);
});
