import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page @param {boolean} sourceMode */
async function openEditor(page, sourceMode) {
  await page.goto('/');
  if (sourceMode) await page.locator('.render-mode-toggle').click();
  return page.getByTestId('editor-textarea');
}

/** @param {import('@playwright/test').Locator} editor @param {number} count */
async function addCarets(editor, count) {
  await editor.press('Control+Home');
  for (let index = 1; index < count; index++) await editor.press('Alt+ArrowDown');
  await expect(editor).toHaveAttribute('data-caret-count', String(count));
}

for (const sourceMode of [false, true]) {
  const mode = sourceMode ? '원문' : '렌더';
  test(`${mode}: 위아래 캐럿 추가와 동시 입력·삭제·실행 취소·해제`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    await editor.fill('alpha\nbeta\ngamma');
    await addCarets(editor, 3);
    await expect(page.locator('.multi-editor-caret')).toHaveCount(3);
    await editor.press('Alt+ArrowUp');
    await expect(editor).toHaveAttribute('data-caret-count', '3');
    await editor.pressSequentially('XY');
    await expect(editor).toHaveValue('XYalpha\nXYbeta\nXYgamma');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('alpha\nbeta\ngamma');
    await expect(editor).toHaveAttribute('data-caret-count', '3');
    await editor.press('Control+y');
    await expect(editor).toHaveValue('XYalpha\nXYbeta\nXYgamma');
    await editor.press('Backspace');
    await expect(editor).toHaveValue('Xalpha\nXbeta\nXgamma');
    await editor.press('Delete');
    await expect(editor).toHaveValue('Xlpha\nXeta\nXamma');
    await editor.press('Escape');
    await expect(editor).toHaveAttribute('data-caret-count', '1');
    await expect(page.locator('.multi-editor-caret')).toHaveCount(0);
    await editor.press('q');
    await expect(editor).toHaveValue('Xlpha\nXqeta\nXamma');
  });

  test(`${mode}: 다중 선택 복사·붙여넣기·잘라내기와 줄별 배분`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await editor.fill('alpha\nbeta\ngamma');
    await addCarets(editor, 3);
    await editor.press('Shift+ArrowRight');
    await editor.press('Shift+ArrowRight');
    await editor.press('Control+c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('al\nbe\nga');
    await page.evaluate(() => navigator.clipboard.writeText('1\n2\n3'));
    await editor.press('Control+v');
    await expect(editor).toHaveValue('1pha\n2ta\n3mma');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('alpha\nbeta\ngamma');
    await editor.press('Control+x');
    await expect(editor).toHaveValue('pha\nta\nmma');
    await editor.press('Control+v');
    await expect(editor).toHaveValue('alpha\nbeta\ngamma');
    await page.evaluate(() => navigator.clipboard.writeText('한글'));
    await editor.press('Control+v');
    await expect(editor).toHaveValue('al한글pha\nbe한글ta\nga한글mma');
  });

  test(`${mode}: 휠 버튼을 누른 위아래 드래그와 일반 클릭 해제`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    await editor.fill('alpha\nbeta\ngamma');
    await editor.press('Control+Home');
    const box = await editor.boundingBox();
    if (!box) throw new Error('편집 영역 없음');
    const metrics = await editor.evaluate(element => {
      const style = getComputedStyle(element);
      return { padding: parseFloat(style.paddingLeft), top: parseFloat(style.paddingTop), height: parseFloat(style.lineHeight) };
    });
    const x = box.x + metrics.padding + 0.25;
    const firstY = box.y + metrics.top + metrics.height / 2;
    for (const reverse of [false, true]) {
      await page.mouse.move(x, reverse ? firstY + metrics.height * 2 : firstY);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(x, reverse ? firstY : firstY + metrics.height * 2, { steps: 8 });
      await page.mouse.up({ button: 'middle' });
      await expect(editor).toHaveAttribute('data-caret-count', '3');
      await editor.press('x');
      await expect(editor).toHaveValue('xalpha\nxbeta\nxgamma');
      await editor.press('Control+z');
      await editor.press('Escape');
    }
    await addCarets(editor, 3);
    await page.mouse.click(x, firstY);
    await expect(editor).toHaveAttribute('data-caret-count', '1');
    await editor.press('z');
    await expect(editor).toHaveValue('zalpha\nbeta\ngamma');
  });

  test(`${mode}: 휠 드래그의 사각 선택과 선택 없는 줄 복사`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await editor.fill('abcdef\nabcdef\nabcdef');
    await editor.press('Control+Home');
    const points = await editor.evaluate(element => {
      const input = /** @type {HTMLTextAreaElement} */ (element);
      const style = getComputedStyle(input);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('글자 너비 측정 실패');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const box = input.getBoundingClientRect();
      const left = box.left + parseFloat(style.paddingLeft);
      const top = box.top + parseFloat(style.paddingTop);
      const height = parseFloat(style.lineHeight);
      return { x1: left + context.measureText('ab').width, x2: left + context.measureText('abcd').width,
        y1: top + height / 2, y2: top + height * 2.5 };
    });
    await page.mouse.move(points.x1, points.y1);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(points.x2, points.y2, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await expect(editor).toHaveAttribute('data-caret-count', '3');
    await editor.press('X');
    await expect(editor).toHaveValue('abXef\nabXef\nabXef');
    await editor.press('Control+c');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('abXef\nabXef\nabXef');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('abcdef\nabcdef\nabcdef');
    await editor.press('Delete');
    await expect(editor).toHaveValue('abef\nabef\nabef');
  });

  test(`${mode}: 짧은 줄의 빈 선택을 잘라내지 않고 선택 방향까지 복원한다`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await editor.fill('aaaa\nx\naaaa');
    await editor.press('Control+Home');
    await editor.press('ArrowRight');
    await editor.press('ArrowRight');
    await editor.press('Alt+ArrowDown');
    await editor.press('Alt+ArrowDown');
    await expect(editor).toHaveAttribute('data-caret-count', '3');
    await editor.press('Shift+End');
    await editor.press('Control+x');
    await expect(editor).toHaveValue('aa\nx\naa');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('aa\n\naa');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('aaaa\nx\naaaa');
    await editor.press('End');
    await editor.press('Shift+ArrowLeft');
    await editor.press('K');
    await expect(editor).toHaveValue('aaaK\nK\naaaK');
    await editor.press('Control+z');
    expect(await editor.evaluate(element => /** @type {HTMLTextAreaElement} */ (element).selectionDirection)).toBe('backward');
    await editor.press('Shift+ArrowLeft');
    await editor.press('K');
    await expect(editor).toHaveValue('aaK\naaK');
  });

  test(`${mode}: 화면 밖으로 휠 드래그해도 지나간 줄의 캐럿을 유지한다`, async ({ page }) => {
    const editor = await openEditor(page, sourceMode);
    const source = Array.from({ length: 200 }, (_, index) => `row${index}`).join('\n');
    await editor.fill(source);
    await editor.press('Control+Home');
    const scroller = sourceMode ? editor : page.getByTestId('editor-viewport');
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
    const box = await page.getByTestId('editor-viewport').boundingBox();
    if (!box) throw new Error('편집 영역 없음');
    const metrics = await editor.evaluate(element => {
      const style = getComputedStyle(element);
      return { padding: parseFloat(style.paddingLeft), top: parseFloat(style.paddingTop), height: parseFloat(style.lineHeight) };
    });
    const x = box.x + metrics.padding + 0.25;
    await page.mouse.move(x, box.y + metrics.top + metrics.height / 2);
    await page.mouse.down({ button: 'middle' });
    expect(await editor.evaluate(element => /** @type {HTMLTextAreaElement} */ (element).selectionStart)).toBe(0);
    await page.mouse.move(x, box.y + box.height + 25, { steps: 8 });
    await expect.poll(async () => Number(await editor.getAttribute('data-caret-count')), { timeout: 15000 }).toBeGreaterThan(70);
    await page.mouse.up({ button: 'middle' });
    const count = Number(await editor.getAttribute('data-caret-count'));
    await editor.press('X');
    await expect(editor).toHaveValue(source.split('\n').map((line, index) => index < count ? `X${line}` : line).join('\n'));
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source);
    await editor.press('Escape');
    await addCarets(editor, 75);
    await editor.press('Z');
    await expect(editor).toHaveValue(source.split('\n').map((line, index) => index < 75 ? `Z${line}` : line).join('\n'));
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
    await page.mouse.click(x, box.y + metrics.top + metrics.height / 2);
    await expect(editor).toHaveAttribute('data-caret-count', '1');
    expect(await editor.evaluate(element => /** @type {HTMLTextAreaElement} */ (element).selectionStart)).toBe(0);
    await editor.press('K');
    await expect(editor).toHaveValue('K' + source.split('\n').map((line, index) => index < 75 ? `Z${line}` : line).join('\n'));
  });

  test(`${mode}: 자동 줄바꿈 줄에도 캐럿을 추가하며 이모지·줄바꿈을 한 번에 편집한다`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 700 });
    const editor = await openEditor(page, sourceMode);
    const source = 'alpha beta gamma delta '.repeat(9);
    await editor.fill(source);
    await addCarets(editor, 3);
    await page.keyboard.insertText('👨‍👩‍👧');
    expect((await editor.inputValue()).split('👨‍👩‍👧').length).toBe(4);
    await editor.press('Backspace');
    await expect(editor).toHaveValue(source);
    await editor.press('Enter');
    expect((await editor.inputValue()).split('\n')).toHaveLength(4);
    await editor.press('Control+z');
    await expect(editor).toHaveValue(source);
  });
}

test('한글 조합 입력은 주 캐럿에서 조합하고 확정할 때 모두 반영한다', async ({ page }) => {
  const editor = await openEditor(page, false);
  await editor.fill('one\ntwo\nthree');
  await addCarets(editor, 3);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await session.send('Input.insertText', { text: '한' });
  await expect(editor).toHaveValue('한one\n한two\n한three');
  await expect(editor).toHaveAttribute('data-caret-count', '3');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('one\ntwo\nthree');
  await editor.press('Control+y');
  await expect(editor).toHaveValue('한one\n한two\n한three');
});

test('렌더의 여러 캐럿에서 서식과 문자 참조를 보존하며 표시 문자만 지운다', async ({ page }) => {
  const editor = await openEditor(page, false);
  const source = '<p><b>&amp;abc</b></p>\n<p><b>&amp;abc</b></p>\n<p><b>&amp;abc</b></p>';
  await editor.fill(source);
  await addCarets(editor, 3);
  await editor.press('Delete');
  await expect(editor).toHaveValue(source.replaceAll('&amp;', ''));
  await editor.press('Control+z');
  await expect(editor).toHaveValue(source);
  await editor.press('K');
  await expect(editor).toHaveValue(source.replaceAll('&amp;', 'K&amp;'));
  await editor.press('Backspace');
  await expect(editor).toHaveValue(source);
});

test('짧은 줄과 목록에서 캐럿을 중복 생성하지 않고 모드·탭 전환 시 해제한다', async ({ page }) => {
  const editor = await openEditor(page, false);
  await editor.fill('1. abcdef\n2. x\n3. ghijkl');
  await addCarets(editor, 3);
  await editor.press('Alt+ArrowDown');
  await expect(editor).toHaveAttribute('data-caret-count', '3');
  await editor.press('K');
  await expect(editor).toHaveValue('1. Kabcdef\n2. Kx\n3. Kghijkl');
  await page.locator('.render-mode-toggle').click();
  await expect(editor).toHaveAttribute('data-caret-count', '1');
  await addCarets(editor, 3);
  await editor.press('Control+n');
  await expect(editor).toHaveValue('');
  await expect(editor).toHaveAttribute('data-caret-count', '1');
});
