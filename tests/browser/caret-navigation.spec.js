import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Locator} editor @param {number} offset */
async function select(editor, offset) {
  await editor.focus();
  await editor.evaluate((element, position) => {
    const input = /** @type {HTMLTextAreaElement} */ (element);
    input.setSelectionRange(position, position);
  }, offset);
  await expect.poll(() => selection(editor)).toEqual([offset, offset]);
}

/** @param {import('@playwright/test').Locator} editor */
const selection = editor => editor.evaluate(element => {
  const input = /** @type {HTMLTextAreaElement} */ (element);
  return [input.selectionStart, input.selectionEnd];
});

for (const format of ['Text', 'Markdown']) {
  test(`${format}: 글머리 본문 시작의 왼쪽 화살표는 이전 줄 끝으로 이동한다`, async ({ page }) => {
    await page.goto('/');
    await page.locator('.new-document-format-trigger').click();
    await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    const editor = page.getByTestId('editor-textarea');
    for (const marker of ['- ', '• ', '1. ', '(a) ', '    2. ', '\t+ ']) {
      const source = `previous\n${marker}body`;
      await editor.fill(source);
      await expect(page.locator('.list-item-body')).toHaveCount(1);
      await editor.press('Control+End');
      await editor.press('Home');
      await expect.poll(() => selection(editor)).toEqual([9 + marker.length, 9 + marker.length]);
      await editor.press('ArrowLeft');
      await expect.poll(() => selection(editor)).toEqual([8, 8]);
      await expect(editor).toHaveValue(source);
    }
    await editor.fill('1. first\n2. second');
    await editor.press('Control+End');
    await editor.press('Home');
    await editor.press('ArrowLeft');
    await expect.poll(() => selection(editor)).toEqual([8, 8]);
    await editor.press('Control+Home');
    await editor.press('ArrowLeft');
    await expect.poll(() => selection(editor)).toEqual([3, 3]);
  });
}

test('렌더 첫 줄과 마지막 줄의 위아래 이동은 허용된 양 끝에 도달한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const sample of [
    { source: 'abcdef', first: 0, last: 6 },
    { source: 'first line\nlast line', first: 0, last: 20 },
    { source: '- abcdef', first: 2, last: 8 },
    { source: '1. first\n2. last', first: 3, last: 16 },
    { source: '# abcdef', first: 0, last: 8 },
    { source: '> abcdef', first: 2, last: 8 },
    // 굵은 서식 뒤, 문단 닫기 앞의 원문 경계도 기존 렌더 편집에서 이동 가능하다.
    { source: '<p><b>abcdef</b></p>', first: 6, last: 16, beforeLast: 10 },
    { source: '```\n    abcdef\n```', first: 4, last: 14 },
    { source: '\nabcdef\n', first: 0, last: 8 }
  ]) {
    await editor.fill(sample.source);
    await select(editor, sample.first + (sample.source.startsWith('\n') ? 0 : 2));
    await editor.press('ArrowUp');
    await expect.poll(() => selection(editor), sample.source).toEqual([sample.first, sample.first]);
    await editor.press('ArrowUp');
    await expect.poll(() => selection(editor)).toEqual([sample.first, sample.first]);
    await select(editor, sample.beforeLast ?? sample.last - (sample.source.endsWith('\n') ? 0 : 2));
    await editor.press('ArrowDown');
    await expect.poll(() => selection(editor), sample.source).toEqual([sample.last, sample.last]);
    await expect(editor).toHaveValue(sample.source);
  }
});

for (const sourceMode of [false, true]) {
  test(`${sourceMode ? '원문' : '렌더'}: 자동 줄바꿈의 중간 줄은 이동하고 끝에서만 양 끝으로 간다`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 700 });
    await page.goto('/');
    const editor = page.getByTestId('editor-textarea');
    if (sourceMode) await page.locator('.render-mode-toggle').click();
    const source = 'alpha beta gamma delta '.repeat(12);
    await editor.fill(source);
    await editor.press('Control+Home');
    await editor.press('ArrowRight');
    await editor.press('ArrowUp');
    await expect.poll(() => selection(editor)).toEqual([0, 0]);
    await editor.press('ArrowDown');
    const middle = (await selection(editor))[0];
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(source.length);
    await editor.press('ArrowDown');
    expect((await selection(editor))[0]).toBeGreaterThan(middle);
    await editor.press('Control+End');
    await editor.press('ArrowLeft');
    await editor.press('ArrowDown');
    await expect.poll(() => selection(editor)).toEqual([source.length, source.length]);
    await expect(editor).toHaveValue(source);
  });
}

test('끝 이동의 Shift 선택은 기준점을 유지하고 실행 취소 기록을 만들지 않는다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('- abcdef');
  await select(editor, 5);
  await editor.press('Shift+ArrowUp');
  await expect.poll(() => selection(editor)).toEqual([2, 5]);
  expect(await editor.evaluate(element => /** @type {HTMLTextAreaElement} */ (element).selectionDirection)).toBe('backward');
  await editor.press('Shift+ArrowDown');
  await expect.poll(() => selection(editor)).toEqual([5, 8]);
  await editor.press('Control+z');
  await expect(editor).toHaveValue('');
});

test('표시 전용으로 펼친 구조에서도 첫 줄과 마지막 줄 경계를 사용한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^JSON$/ }).click();
  const editor = page.getByTestId('editor-textarea');
  const source = '{"alpha":1,"beta":2}';
  await editor.fill(source);
  await expect(page.locator('.pretty-print-row')).toHaveCount(4);
  await editor.press('Control+Home');
  await editor.press('End');
  await editor.press('ArrowUp');
  await expect.poll(() => selection(editor)).toEqual([0, 0]);
  await editor.press('ArrowDown');
  await expect.poll(() => selection(editor)).toEqual([1, 1]);
  await editor.press('Control+End');
  await editor.press('Home');
  await editor.press('ArrowDown');
  await expect.poll(() => selection(editor)).toEqual([source.length, source.length]);
  await expect(editor).toHaveValue(source);
});
