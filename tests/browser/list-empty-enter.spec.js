import { expect, test } from '@playwright/test';

test('빈 중첩 글머리는 같은 줄에서 이전 깊이와 다음 번호를 즉시 복원한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const initial = '1. 첫 번째 줄\n    A. 두 번째 줄\n    B. 세 번째 줄';
  await editor.fill(initial);
  await editor.press('Control+End');
  await editor.press('Enter');
  await expect(editor).toHaveValue(`${initial}\n    C. `);
  await editor.press('Enter');
  await expect(editor).toHaveValue(`${initial}\n2. `);
  await expect(page.locator('.list-item-prefix').last()).toContainText('2.');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(`${initial}\n    C. `);
  await editor.press('Control+y');
  await expect(editor).toHaveValue(`${initial}\n2. `);
  await expect.poll(() => editor.evaluate(e => {
    const input = /** @type {HTMLTextAreaElement} */ (e);
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([initial.length + 4, initial.length + 4]);
});

for (const sample of [
  { name: '순서 있는', initial: '1. parent\n    A. child\n        1. grandchild\n            i. ', prefixes: ['        2. ', '    B. ', '2. ', ''] },
  { name: '순서 없는', initial: '- parent\n    * child\n        + grandchild\n            • ', prefixes: ['        + ', '    * ', '- ', ''] },
  { name: '탭과 괄호 형식', initial: '(009) parent\n\t(a) child\n\t\t1) grandchild\n\t\t\ti. ', prefixes: ['\t\t2) ', '\t(b) ', '(010) ', ''] },
  { name: '이전 깊이 없는 항목', initial: '            1. ', prefixes: ['        ', '    ', ''] }
]) {
  test(`${sample.name}: Enter마다 한 단계 줄이고 각 상태와 캐럿을 복원한다`, async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('editor-textarea');
    await editor.fill(sample.initial);
    await editor.press('Control+End');
    const base = sample.initial.slice(0, sample.initial.lastIndexOf('\n') + 1);
    const states = [sample.initial];
    for (const prefix of sample.prefixes) {
      await editor.press('Enter');
      const state = base + prefix;
      states.push(state);
      await expect(editor).toHaveValue(state);
      await expect.poll(() => editor.evaluate(e => {
        const input = /** @type {HTMLTextAreaElement} */ (e);
        return [input.selectionStart, input.selectionEnd];
      })).toEqual([state.length, state.length]);
    }
    for (let i = states.length - 2; i >= 0; i--) {
      await editor.press('Control+z');
      await expect(editor).toHaveValue(states[i]);
      await expect.poll(() => editor.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(states[i].length);
    }
    for (const state of states.slice(1)) {
      await editor.press('Control+y');
      await expect(editor).toHaveValue(state);
      await expect.poll(() => editor.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(state.length);
    }
  });
}

test('앞 항목의 알파벳 문맥과 뒤 항목 번호를 함께 유지한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const initial = 'G. before\nH. parent\n    A. child\n    B. \nI. after\nJ. last';
  await editor.fill(initial);
  await editor.press('Control+Home');
  for (let i = 0; i < 3; i++) await editor.press('ArrowDown');
  await editor.press('End');
  await editor.press('Enter');
  await expect(editor).toHaveValue('G. before\nH. parent\n    A. child\nI. \nJ. after\nK. last');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(initial);
});

test('빈 일반 들여쓰기와 원문 모드는 각각의 Enter 계약을 따른다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('plain\n            ');
  await editor.press('Control+End');
  for (const count of [8, 4, 0]) {
    await editor.press('Enter');
    await expect(editor).toHaveValue(`plain\n${' '.repeat(count)}`);
  }
  await editor.fill('1. parent\n    A. ');
  await editor.press('Control+End');
  await editor.press('Shift+Enter');
  expect((await editor.inputValue()).split('\n')).toHaveLength(3);
  await page.locator('.render-mode-toggle').click();
  await editor.fill('1. parent\n    A. ');
  await editor.press('Control+End');
  await editor.press('Enter');
  await expect(editor).toHaveValue('1. parent\n    A. \n');
});
