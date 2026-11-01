import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Locator} editor @param {number} start @param {number} [end] */
async function select(editor, start, end = start) {
  await editor.focus();
  await editor.evaluate((element, range) => /** @type {HTMLTextAreaElement} */ (element).setSelectionRange(range[0], range[1]), [start, end]);
}

/** @param {HTMLElement | SVGElement} element */
const caretOffset = element => /** @type {HTMLTextAreaElement} */ (element).selectionStart;

test('목록 항목 삭제와 뒷번호 조정은 한 번에 되돌린다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '1. one\n2. two\n3. three\n4. four';
  await editor.fill(source);
  await select(editor, 7, 14);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('1. one\n2. three\n3. four');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(source);
  await editor.press('Control+y');
  await expect(editor).toHaveValue('1. one\n2. three\n3. four');
  await editor.fill(source);
  await select(editor, 0, 7);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('1. two\n2. three\n3. four');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(source);
});

test('중첩 괄호 쌍 삭제와 미완성 따옴표 닫기는 같은 원문 줄에서 작동한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('(())');
  await select(editor, 2);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('()');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('(())');
  await editor.fill('""""');
  await select(editor, 2);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('""');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('""""');
  await editor.fill('"hello');
  await select(editor, 6);
  await page.keyboard.press('Shift+Quote');
  await expect(editor).toHaveValue('"hello"');
  await editor.fill('"earlier\nhello');
  await select(editor, 14);
  await page.keyboard.press('Shift+Quote');
  await expect(editor).toHaveValue('"earlier\nhello""');
  await editor.fill('"');
  await select(editor, 0);
  await page.keyboard.press('Shift+Quote');
  await expect(editor).toHaveValue('""');
});

test('체크박스는 앞뒤에서 한 글자처럼 지워지고 실행 취소된다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const marker of ['[]', '[V]']) {
    await editor.fill(`${marker} task`);
    await select(editor, marker.length);
    await editor.press('Backspace');
    await expect(editor).toHaveValue(' task');
    await editor.press('Control+z');
    await expect(editor).toHaveValue(`${marker} task`);
    await select(editor, marker.length + 1);
    await editor.press('Backspace');
    await expect(editor).toHaveValue(' task');
    await editor.press('Control+z');
    await select(editor, 0);
    await editor.press('Delete');
    await expect(editor).toHaveValue(' task');
  }
});

test('구분선을 지나 이동하고 삭제할 수 있다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('---\nnext');
  await expect(page.locator('.rich-content hr')).toBeVisible();
  await select(editor, 0);
  await editor.press('ArrowRight');
  await expect.poll(() => editor.evaluate(caretOffset)).toBe(3);
  await editor.press('Backspace');
  await expect(editor).toHaveValue('\nnext');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('---\nnext');
  await editor.fill('---');
  await select(editor, 3);
  await editor.press('Enter');
  await expect(editor).toHaveValue('---\n');
  await expect.poll(() => editor.evaluate(caretOffset)).toBe(4);
});

test('자동 줄바꿈한 일반 텍스트에서 위아래 이동을 반복할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 500 });
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '긴 문장을 자연스럽게 접어서 표시하는 동안 커서가 다음 표시 줄로 이동해야 합니다. '.repeat(8);
  await editor.fill(source);
  await select(editor, 0);
  await editor.press('ArrowDown');
  const first = await editor.evaluate(caretOffset);
  expect(first).toBeGreaterThan(0);
  await editor.press('ArrowDown');
  const second = await editor.evaluate(caretOffset);
  expect(second).toBeGreaterThan(first);
  await editor.press('ArrowUp');
  await expect.poll(() => editor.evaluate(caretOffset)).toBe(first);
});
