import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Locator} editor */
const selection = editor => editor.evaluate(element => {
  const input = /** @type {HTMLTextAreaElement} */ (element);
  return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
});

/** @param {import('@playwright/test').Page} page */
async function markdownEditor(page) {
  await page.goto('/');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^Markdown$/ }).click();
  return page.getByTestId('editor-textarea');
}

test('Markdown 렌더 기능을 끄면 기본 원문 문자 이동을 유지한다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('text-pad.settings', JSON.stringify({
    format: 'text-pad-settings', schemaVersion: 1,
    settings: { render: { formats: { features: { markdown: { render: false, edit: true } } } } }
  })));
  const editor = await markdownEditor(page);
  await editor.fill('**abc**');
  await editor.press('Control+Home');
  await editor.press('ArrowRight');
  await editor.press('X');
  await expect(editor).toHaveValue('*X*abc**');
});

test('화면 밖 HTML 끝 이동과 입력은 화면 안의 원문 경계와 같다', async ({ page }) => {
  const editor = await markdownEditor(page);
  for (const prefix of ['', 'plain\n'.repeat(300) + '\n']) {
    const source = prefix + '<p>end</p>';
    await editor.fill(source);
    await editor.press('Control+Home');
    if (prefix) await expect(page.locator('.rich-content p')).toHaveCount(0);
    await editor.press('Control+End');
    await expect.poll(() => selection(editor)).toMatchObject({ start: prefix.length + 6, end: prefix.length + 6 });
    await editor.press('X');
    await expect(editor).toHaveValue(prefix + '<p>endX</p>');
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source);
  }
});

test('링크 유무가 강조 문자 이동과 삭제의 의미를 바꾸지 않는다', async ({ page }) => {
  const editor = await markdownEditor(page);
  for (const tail of ['', ' first@example.com']) {
    const source = '**a👩‍💻b**' + tail;
    await editor.fill(source);
    await editor.press('Control+Home');
    await editor.press('ArrowRight');
    await editor.press('X');
    await expect(editor).toHaveValue('**aX👩‍💻b**' + tail);
    await editor.press('Delete');
    await expect(editor).toHaveValue('**aXb**' + tail);
    await editor.press('Control+z');
    await expect(editor).toHaveValue('**aX👩‍💻b**' + tail);
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source);
  }
});

test('목록 Enter와 본문 시작 Backspace는 링크 유무에 상관없이 목록 규칙을 따른다', async ({ page }) => {
  const editor = await markdownEditor(page);
  for (const body of ['plain', 'first@example.com']) {
    await editor.fill('- ' + body);
    await editor.press('Control+End');
    await editor.press('Enter');
    await expect(editor).toHaveValue('- ' + body + '\n- ');
    await editor.press('Control+z');
    await editor.press('Home');
    await editor.press('Backspace');
    await expect(editor).toHaveValue(body);
    await editor.press('Control+z');
    await expect(editor).toHaveValue('- ' + body);
  }
  await editor.fill('before\n\n> after');
  await editor.press('Control+End');
  await editor.press('Home');
  await editor.press('Backspace');
  await expect(editor).toHaveValue('before\n\nafter');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('before\n\n> after');
});

for (const sourceMode of [false, true]) {
  test(`${sourceMode ? '원문' : '렌더'}: 역방향 선택은 실행 취소와 탭 왕복 뒤 같은 기준점에서 확장된다`, async ({ page }) => {
    const editor = await markdownEditor(page);
    if (sourceMode) await page.locator('.render-mode-toggle').click();
    await editor.fill('abcdef');
    await editor.press('Control+End');
    for (let i = 0; i < 3; i++) await editor.press('Shift+ArrowLeft');
    await editor.press('X');
    await editor.press('Control+z');
    await expect.poll(() => selection(editor)).toEqual({ start: 3, end: 6, direction: 'backward' });
    await editor.press('Control+n');
    await editor.fill('another tab');
    await page.getByRole('tab').first().click();
    await expect(editor).toHaveValue('abcdef');
    await expect.poll(() => selection(editor)).toEqual({ start: 3, end: 6, direction: 'backward' });
    await editor.press('Shift+ArrowLeft');
    await expect.poll(() => selection(editor)).toEqual({ start: 2, end: 6, direction: 'backward' });
  });
}

test('짧은 줄을 지난 다중 캐럿의 세로 이동은 원래 가로 위치를 유지한다', async ({ page }) => {
  const editor = await markdownEditor(page);
  await editor.fill('abcdefghij\nabcdefghij\nx\nabcdefghij\nabcdefghij');
  await editor.press('Control+Home');
  for (let i = 0; i < 7; i++) await editor.press('ArrowRight');
  await editor.press('Alt+ArrowDown');
  await expect(editor).toHaveAttribute('data-caret-count', '2');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  await editor.press('X');
  await expect(editor).toHaveValue('abcdefghij\nabcdefghij\nx\nabcdefgXhij\nabcdefgXhij');
});

test('접힌 내용은 편집 경계에서 제외하고 펼친 상태는 가상화 왕복에도 유지한다', async ({ page }) => {
  const editor = await markdownEditor(page);
  const prefix = 'plain\n'.repeat(300) + '\n';
  const block = '<details>\n<summary>Title</summary>\n\nHidden body\n\n</details>';
  const source = prefix + block;
  await editor.fill(source);
  await editor.press('Control+Home');
  await expect(page.locator('.rich-content details')).toHaveCount(0);
  await editor.press('Control+End');
  await editor.press('Backspace');
  await expect(editor).toHaveValue(source.replace('Title', 'Titl'));
  await editor.press('Control+z');
  await page.locator('.rich-content summary').click({ modifiers: ['Control'] });
  await expect(page.locator('.rich-content details')).toHaveAttribute('open', '');
  await editor.press('Control+Home');
  await expect(page.locator('.rich-content details')).toHaveCount(0);
  await editor.press('Control+End');
  await expect(page.locator('.rich-content details')).toHaveAttribute('open', '');
  await expect.poll(async () => (await selection(editor)).start).toBeGreaterThan(source.indexOf('Hidden body'));
  await expect(editor).toHaveValue(source);
});

test('크기가 다른 제목과 문단 사이의 세로 이동은 실제 인접 행을 따른다', async ({ page }) => {
  const editor = await markdownEditor(page);
  const source = '<h1>Large heading</h1>\n<p>Small paragraph</p>\n<h2>Next heading</h2>';
  const middle = source.indexOf('Small'), last = source.indexOf('Next');
  await editor.fill(source);
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await expect.poll(async () => (await selection(editor)).start).toBe(middle);
  await editor.press('Shift+ArrowDown');
  await expect.poll(() => selection(editor)).toMatchObject({ start: middle, end: last });
  await editor.press('Shift+ArrowUp');
  await expect.poll(() => selection(editor)).toMatchObject({ start: middle, end: middle });
});
