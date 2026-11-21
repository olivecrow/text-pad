import { expect, test } from '@playwright/test';

test('연속 빈 줄을 드래그하면 선택된 줄바꿈의 표시 행만 강조한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  await editor.fill('start');
  for (let n = 0; n < 5; n++) await editor.press('Enter');
  await page.keyboard.insertText('tail');
  await expect(editor).toHaveValue('start\n\n\n\n\ntail');
  const rows = [];
  for (let line = 1; line <= 4; line++) {
    const row = await page.locator(`.backdrop-line[data-line-index="${line}"]`).boundingBox();
    if (!row) throw new Error(`Missing empty row ${line}`);
    rows.push(row);
  }
  const paintedRows = () => page.locator('.render-selection-decoration').evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const row = Array.from(document.querySelectorAll('.backdrop-line[data-line-index]')).find(line => {
      const bounds = line.getBoundingClientRect();
      return y >= bounds.top && y < bounds.bottom;
    });
    return Number(row?.getAttribute('data-line-index'));
  }));
  for (const backward of [false, true]) {
    const [from, to] = backward ? [rows[3], rows[0]] : [rows[0], rows[3]];
    await page.mouse.move(from.x + 28, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 28, to.y + to.height / 2, { steps: 6 });
    await expect.poll(() => editor.evaluate(el => {
      const input = /** @type {HTMLTextAreaElement} */ (el);
      return [input.selectionStart, input.selectionEnd, input.selectionDirection];
    })).toEqual([6, 9, backward ? 'backward' : 'forward']);
    await expect.poll(paintedRows).toEqual([1, 2, 3]);
    await page.mouse.up();
    await expect.poll(paintedRows).toEqual([1, 2, 3]);
  }
});

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

test('인용문·여러 줄 강조·링크의 줄바꿈 앞 연속 공백도 캐럿이 밀리거나 줄을 건너뛰지 않는다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const caret = page.locator('.steady-editor-caret');
  for (const { source, caretPos } of [
    { source: '> 첫줄\n> 둘째', caretPos: 4 },
    { source: '**첫줄\n둘째**', caretPos: 4 },
    { source: 'user@example.com\n둘째', caretPos: 16 }
  ]) {
    await editor.fill(source);
    await editor.click();
    await editor.evaluate((el, pos) => {
      const input = /** @type {HTMLTextAreaElement} */ (el);
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new Event('select', { bubbles: true }));
    }, caretPos);
    await expect(caret).toBeVisible();
    let previousX = (await caret.boundingBox())?.x ?? 0;
    for (let n = 1; n <= 2; n++) {
      await editor.press('Space');
      await expect(editor).toHaveValue(source.slice(0, caretPos) + ' '.repeat(n) + source.slice(caretPos));
      await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart)).toBe(caretPos + n);
      await expect.poll(async () => (await caret.boundingBox())?.x ?? 0).toBeGreaterThan(previousX);
      previousX = (await caret.boundingBox())?.x ?? previousX;
    }
    await page.keyboard.insertText('테스트');
    await expect(editor).toHaveValue(source.slice(0, caretPos) + '  테스트' + source.slice(caretPos));
  }
});

test('인용문 Enter와 복합 목록 빈 항목, 인라인 공백 편집이 현재 위치를 유지한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const caret = page.locator('.steady-editor-caret');

  await editor.fill('> 인용문');
  await editor.press('Control+End');
  const line1Y = (await caret.boundingBox())?.y ?? 0;
  await editor.press('Enter');
  await expect(editor).toHaveValue('> 인용문  \n> ');
  await expect.poll(async () => (await caret.boundingBox())?.y ?? 0).toBeGreaterThan(line1Y + 5);
  await page.keyboard.insertText('한글 테스트');
  await expect(editor).toHaveValue('> 인용문  \n> 한글 테스트');
  await editor.press('Control+z');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('> 인용문');

  await editor.fill('# 제목\n\n- [링크](https://example.com)\n- ');
  await editor.press('Control+End');
  await page.keyboard.insertText('안녕 하세요');
  await expect(editor).toHaveValue('# 제목\n\n- [링크](https://example.com)\n- 안녕 하세요');

  await editor.fill('> 첫째 둘째');
  await editor.click();
  await editor.evaluate((el) => {
    const input = /** @type {HTMLTextAreaElement} */ (el);
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new Event('select', { bubbles: true }));
  });
  const beforeSpaceX = (await caret.boundingBox())?.x ?? 0;
  await editor.press('Space');
  await editor.press('Space');
  await expect.poll(async () => (await caret.boundingBox())?.x ?? 0).toBeGreaterThan(beforeSpaceX);
  await expect(editor).toHaveValue('> 첫째   둘째');
});

test('제목과 글머리가 있는 마크다운 문서의 일반 줄 한글 조합과 공백 입력이 위치를 유지한다', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByTestId('editor-textarea');
  const sections = Array.from({ length: 30 }, (_, i) =>
    `# 섹션 제목 ${i + 1}\n\n- 항목 ${i + 1}\n  - 하위 항목 ${i + 1}\n\n일반 문단 텍스트입니다.`
  ).join('\n\n');
  const initial = `${sections}\n\n`;
  await editor.fill(initial);
  await editor.click();
  await editor.press('Control+End');

  const cdp = await page.context().newCDPSession(page);
  const sequence = [
    ['ㅇ', '아', '안'],
    ['ㄴ', '녀', '녕'],
    ' ',
    ['ㅎ', '하'],
    ['ㅅ', '세'],
    ['ㅇ', '요']
  ];
  for (const step of sequence) {
    if (step === ' ') {
      await page.keyboard.press('Space');
    } else {
      for (const stage of step) {
        await cdp.send('Input.imeSetComposition', { text: stage, selectionStart: 1, selectionEnd: 1 });
      }
      await cdp.send('Input.insertText', { text: step.at(-1) ?? '' });
    }
  }
  await cdp.detach();

  await expect(editor).toHaveValue(`${initial}안녕 하세요`);
  await expect.poll(() => editor.evaluate(el => /** @type {HTMLTextAreaElement} */ (el).selectionStart))
    .toBe(`${initial}안녕 하세요`.length);
});
