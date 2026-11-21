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

/** @param {import('@playwright/test').Locator} editor */
const directedSelection = editor => editor.evaluate(element => {
  const input = /** @type {HTMLTextAreaElement} */ (element);
  return [input.selectionStart, input.selectionEnd, input.selectionDirection];
});

test('렌더 모드 방향키로 인라인 코드의 양쪽 백틱 바깥에 입력할 수 있다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const { prefix, delimiter } of [{ prefix: '', delimiter: '`' }, { prefix: '> ', delimiter: '``' }]) {
    const source = `${prefix}${delimiter}abc${delimiter}`;
    const bodyStart = prefix.length + delimiter.length;
    const bodyEnd = bodyStart + 3;
    await editor.fill(source);
    await select(editor, bodyEnd);
    await editor.press('Shift+ArrowRight');
    await expect.poll(() => selection(editor), source).toEqual([bodyEnd, source.length]);
    await editor.press('ArrowLeft');
    await editor.press('ArrowRight');
    await expect.poll(() => selection(editor), source).toEqual([source.length, source.length]);
    await expect.poll(async () => {
      const code = await page.locator('.rich-content code, .hl-code').boundingBox();
      const caret = await page.locator('.steady-editor-caret').boundingBox();
      return code && caret ? Math.abs(caret.x - (code.x + code.width)) : Infinity;
    }, source).toBeLessThan(1);
    await editor.press('Space');
    await page.keyboard.insertText('뒤');
    await expect(editor).toHaveValue(`${source} 뒤`);
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source);

    await select(editor, bodyStart);
    await editor.press('ArrowLeft');
    await expect.poll(() => selection(editor), source).toEqual([prefix.length, prefix.length]);
    await page.keyboard.insertText('앞 ');
    await expect(editor).toHaveValue(`${prefix}앞 ${delimiter}abc${delimiter}`);
  }
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
      await editor.press('ArrowRight');
      const body = 9 + marker.length;
      await expect.poll(() => selection(editor)).toEqual([body, body]);
      await editor.press('Shift+ArrowLeft');
      await expect.poll(() => directedSelection(editor)).toEqual([8, body, 'backward']);
      await editor.press('Shift+ArrowRight');
      await expect.poll(() => selection(editor)).toEqual([body, body]);
      await editor.press('Shift+ArrowRight');
      await expect.poll(() => directedSelection(editor)).toEqual([body, body + 1, 'forward']);
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

test('복합 인라인 코드의 줄 시작과 끝에서 숨긴 백틱 바깥에 머문다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const source = '> ``xyz``';
  await editor.fill(source);
  await expect(page.locator('.render-rich-block code')).toHaveText('xyz');
  await select(editor, 7);
  await editor.press('Shift+ArrowDown');
  await expect.poll(() => directedSelection(editor)).toEqual([7, 9, 'forward']);
  await editor.press('Shift+ArrowRight');
  await expect.poll(() => selection(editor)).toEqual([7, 9]);
  await editor.press('Shift+ArrowLeft');
  await expect.poll(() => selection(editor)).toEqual([7, 7]);
  await editor.press('Shift+ArrowLeft');
  await expect.poll(() => directedSelection(editor)).toEqual([6, 7, 'backward']);
  await select(editor, 2);
  await editor.press('ArrowUp');
  await expect.poll(() => selection(editor)).toEqual([2, 2]);
  await editor.press('ArrowRight');
  await expect.poll(() => selection(editor)).toEqual([4, 4]);
  await editor.press('Shift+ArrowUp');
  await expect.poll(() => directedSelection(editor)).toEqual([2, 4, 'backward']);
  await expect(editor).toHaveValue(source);
});

test('코드 블록은 울타리를 통째로 건너고 구조만 정확히 선택해 실행 취소할 수 있다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const block = '```js\nvalue\n```';
  const source = `before\n${block}\nafter`;
  const start = 'before\n'.length;
  const end = start + block.length;
  const bodyStart = source.indexOf('value');
  const bodyEnd = bodyStart + 'value'.length;
  await editor.fill(source);
  await select(editor, bodyStart);
  await editor.press('ArrowLeft');
  await expect.poll(() => selection(editor)).toEqual([start - 1, start - 1]);
  await editor.press('ArrowRight');
  await expect.poll(() => selection(editor)).toEqual([bodyStart, bodyStart]);
  const opener = await page.locator('.fenced-code-start').boundingBox();
  const closer = await page.locator('.fenced-code-end').boundingBox();
  if (!opener || !closer) throw new Error('Missing fence rows');
  const left = opener.x + 16;
  const from = opener.y + opener.height / 2;
  const to = closer.y + closer.height / 2;
  await page.mouse.move(left, from);
  await page.mouse.down();
  await page.mouse.move(left, to, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => directedSelection(editor)).toEqual([start, end, 'forward']);
  await editor.press('Shift+ArrowLeft');
  await expect.poll(() => selection(editor)).toEqual([start, bodyEnd]);
  await editor.press('Shift+ArrowRight');
  await expect.poll(() => selection(editor)).toEqual([start, end]);
  await editor.press('Delete');
  await expect(editor).toHaveValue('before\n\nafter');
  await editor.press('Control+z');
  await expect(editor).toHaveValue(source);
  await expect.poll(() => selection(editor)).toEqual([start, end]);

  await page.mouse.move(left, to);
  await page.mouse.down();
  await page.mouse.move(left, from, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => directedSelection(editor)).toEqual([start, end, 'backward']);
  await editor.press('Shift+ArrowLeft');
  await expect.poll(() => selection(editor)).toEqual([start - 1, end]);
  await expect(editor).toHaveValue(source);
});

test('문서 양 끝의 코드 울타리와 빈 코드 블록에서 방향키가 원문을 편집하지 않는다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const source of ['```\ncode\n```', '```\n```', '```\ncode']) {
    await editor.fill(source);
    await editor.press('Control+Home');
    for (const key of ['ArrowLeft', 'ArrowUp', 'Shift+ArrowLeft', 'Shift+ArrowUp']) await editor.press(key);
    await expect(editor).toHaveValue(source);
    await editor.press('Control+End');
    for (const key of ['ArrowRight', 'ArrowDown', 'Shift+ArrowRight', 'Shift+ArrowDown']) await editor.press(key);
    await expect(editor).toHaveValue(source);
  }
});

test('오른쪽·아래 방향키로 닫는 울타리를 지나 입력해도 코드 블록이 유지된다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const block = '```js\nvalue\n```';
  const bodyEnd = block.indexOf('value') + 'value'.length;
  for (const key of ['ArrowRight', 'ArrowDown']) {
    for (const trailing of ['\nafter', '']) {
      await editor.fill(block + trailing);
      await select(editor, bodyEnd);
      await editor.press(key);
      const [destination, end] = await selection(editor);
      expect(end).toBe(destination);
      if (trailing && key === 'ArrowDown') {
        expect(destination).toBeGreaterThanOrEqual(block.length + 1);
      } else {
        expect(destination).toBe(trailing ? block.length + 1 : bodyEnd);
      }
      await page.keyboard.insertText('새 글');
      const source = block + trailing;
      const result = source.slice(0, destination) + '새 글' + source.slice(destination);
      await expect(editor).toHaveValue(result);
      await expect(page.locator('.fenced-code-end')).toHaveCount(1);
      await editor.press('Control+z');
      await expect(editor).toHaveValue(block + trailing);
    }
  }
  await editor.fill('```\n```');
  await editor.press('Control+End');
  await page.keyboard.insertText('빈 블록에 입력');
  await expect(editor).toHaveValue('```\n빈 블록에 입력\n```');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('```\n```');

  const ime = await page.context().newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  await ime.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await ime.send('Input.insertText', { text: '한' });
  await ime.detach();
  await expect(editor).toHaveValue('```\n한\n```');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('```\n```');
});

test('인용문에 포함된 코드 블록과 표도 정확한 원문 경계가 있다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  for (const block of ['```js\n> value\n> ```', '| A | B |\n> | --- | --- |\n> | 1 | 2 |']) {
    const source = `> before\n>\n> ${block}\n>\n> after`;
    const start = source.indexOf(block);
    const end = start + block.length;
    await editor.fill(source);
    await expect(page.locator('.rich-block-boundary')).toHaveCount(2);
    const bounds = page.locator('.rich-block-boundary');
    const first = await bounds.first().boundingBox();
    const last = await bounds.last().boundingBox();
    if (!first || !last) throw new Error('Missing block edges');
    for (const reverse of [false, true]) {
      const [a, b] = reverse ? [last, first] : [first, last];
      await page.mouse.move(a.x + 1, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 1, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => directedSelection(editor)).toEqual([start, end, reverse ? 'backward' : 'forward']);
    }
    await expect(editor).toHaveValue(source);
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
