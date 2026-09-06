// @ts-expect-error 브라우저 테스트는 Node에서 실행되지만 앱의 타입 환경에는 Node 선언을 포함하지 않는다.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

function createWrappedFencedCodeDocument() {
  const longValue = 'rendered-code-width-'.repeat(14);
  const codeLines = Array.from(
    { length: 80 },
    (_, index) => `const row${String(index + 1).padStart(2, '0')} = "${longValue}${index + 1}";`
  );

  return [
    '# Render viewport regression',
    '',
    '```ts',
    ...codeLines,
    '```',
    '',
    'END_MARKER'
  ].join('\n');
}

test('final fenced-code layout owns the complete scroll range', async ({ page }) => {
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string[]} */
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  const viewport = page.getByTestId('editor-viewport');
  const textarea = page.getByTestId('editor-textarea');
  const content = createWrappedFencedCodeDocument();
  const finalLineIndex = content.split('\n').length - 1;

  await expect(viewport).toBeVisible();
  await textarea.fill(content);
  await textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(0, 0);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect.poll(async () => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(1);

  const firstWrappedCodeLine = page.locator('.backdrop-line.fenced-code-middle').first();
  await expect(firstWrappedCodeLine).toBeVisible();
  await expect.poll(async () => firstWrappedCodeLine.evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return element.getBoundingClientRect().height / lineHeight;
  })).toBeGreaterThan(1.5);

  await viewport.hover();
  await page.mouse.wheel(0, 100_000);
  await expect.poll(async () => viewport.evaluate((element) => (
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  ))).toBeLessThanOrEqual(1);

  const finalLine = page.locator(`.backdrop-line[data-line-index="${finalLineIndex}"]`);
  await expect(finalLine).toContainText('END_MARKER');
  await expect(finalLine).toBeVisible();

  await expect.poll(async () => viewport.evaluate((element) => {
    const extent = document.querySelector('[data-testid="editor-render-scroll-extent"]');
    const extentHeight = extent?.getBoundingClientRect().height ?? 0;
    return Math.abs(element.scrollHeight - extentHeight);
  })).toBeLessThanOrEqual(1);

  const finalMetrics = await viewport.evaluate((element) => {
    const extent = document.querySelector('[data-testid="editor-render-scroll-extent"]');
    return {
      clientHeight: element.clientHeight,
      extentHeight: extent?.getBoundingClientRect().height ?? 0,
      maximumScrollTop: element.scrollHeight - element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    };
  });
  expect(finalMetrics.extentHeight).toBeGreaterThan(finalMetrics.clientHeight);
  expect(finalMetrics.scrollHeight).toBe(finalMetrics.extentHeight);
  expect(Math.abs(finalMetrics.maximumScrollTop - finalMetrics.scrollTop)).toBeLessThanOrEqual(1);

  await page.waitForTimeout(250);
  await expect.poll(async () => viewport.evaluate((element) => (
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  ))).toBeLessThanOrEqual(1);

  await viewport.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThan(finalMetrics.scrollTop);

  await page.mouse.wheel(0, 100_000);
  await expect.poll(async () => viewport.evaluate((element) => (
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  ))).toBeLessThanOrEqual(1);
  await expect(finalLine).toContainText('END_MARKER');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('render checkboxes toggle source text and remain one undo step', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');

  const textarea = page.getByTestId('editor-textarea');
  const checkboxes = page.locator('.hl-checkbox');

  await textarea.fill('[]');
  await expect(checkboxes).toHaveCount(0);
  await textarea.press('End');
  await textarea.press('Space');
  await expect(textarea).toHaveValue('[] ');
  await expect(checkboxes).toHaveCount(1);

  const source = '[] pending\n[V] complete\n[]\n[V]\n[]attached\n[V]attached\n[]\ttabbed\nplain';
  await textarea.fill(source);

  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toHaveText('[]');
  await expect(checkboxes.nth(0)).not.toHaveClass(/hl-checkbox-checked/);
  await expect(checkboxes.nth(1)).toHaveText('[V]');
  await expect(checkboxes.nth(1)).toHaveClass(/hl-checkbox-checked/);

  const firstCheckbox = await checkboxes.nth(0).boundingBox();
  expect(firstCheckbox).not.toBeNull();
  if (!firstCheckbox) return;
  await page.mouse.move(firstCheckbox.x + firstCheckbox.width / 2, firstCheckbox.y + firstCheckbox.height / 2);
  await expect.poll(() => textarea.evaluate((element) => element.style.cursor)).toBe('pointer');
  await page.mouse.down();
  await page.mouse.up();

  const checkedSource = '[V] pending\n[V] complete\n[]\n[V]\n[]attached\n[V]attached\n[]\ttabbed\nplain';
  await expect(textarea).toHaveValue(checkedSource);
  await expect(checkboxes.nth(0)).toHaveClass(/hl-checkbox-checked/);

  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(source);
  await expect(checkboxes.nth(0)).not.toHaveClass(/hl-checkbox-checked/);

  await textarea.press('Control+y');
  await expect(textarea).toHaveValue(checkedSource);
  await expect(checkboxes.nth(0)).toHaveClass(/hl-checkbox-checked/);

  await page.locator('.render-mode-toggle').click();
  await expect(checkboxes).toHaveCount(0);
  await expect(textarea).toHaveValue(checkedSource);
});

test('render checkboxes continue on Enter and keep one final visual width', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');

  const textarea = page.getByTestId('editor-textarea');
  await textarea.fill('[] item1\n[V] item1');
  await expect(page.locator('.hl-checkbox')).toHaveCount(2);

  const checkboxMetrics = await page.locator('.backdrop-line').evaluateAll((lines) => lines.slice(0, 2).map((line) => {
    const checkbox = line.querySelector('.hl-checkbox');
    if (!(checkbox instanceof HTMLElement)) return null;

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let itemLeft = Number.NaN;
    let node = walker.nextNode();
    while (node) {
      const itemIndex = node.textContent?.indexOf('item1') ?? -1;
      if (itemIndex >= 0) {
        const range = document.createRange();
        range.setStart(node, itemIndex);
        range.setEnd(node, itemIndex + 1);
        itemLeft = range.getBoundingClientRect().left;
        break;
      }
      node = walker.nextNode();
    }

    const checkboxRect = checkbox.getBoundingClientRect();
    return {
      checkboxWidth: checkboxRect.width,
      itemLeft,
      gap: itemLeft - checkboxRect.right
    };
  }));
  expect(checkboxMetrics).toHaveLength(2);
  expect(checkboxMetrics.every((metric) => metric !== null && Number.isFinite(metric.itemLeft))).toBe(true);
  const uncheckedMetrics = checkboxMetrics[0];
  const checkedMetrics = checkboxMetrics[1];
  if (!uncheckedMetrics || !checkedMetrics) return;
  expect(Math.abs(uncheckedMetrics.checkboxWidth - checkedMetrics.checkboxWidth)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(uncheckedMetrics.itemLeft - checkedMetrics.itemLeft)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(uncheckedMetrics.gap - checkedMetrics.gap)).toBeLessThanOrEqual(0.1);

  await textarea.fill('[V] item');
  await textarea.press('End');
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('    [V] item');
  await expect(page.locator('.hl-checkbox')).toHaveCount(1);
  await expect(page.locator('.hl-checkbox')).toHaveClass(/hl-checkbox-checked/);
  await textarea.press('Shift+Tab');
  await expect(textarea).toHaveValue('[V] item');
  await expect(page.locator('.hl-checkbox')).toHaveClass(/hl-checkbox-checked/);

  await textarea.fill('[] first');
  await textarea.press('End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('[] first\n[] ');
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue('[] first');
  await textarea.press('Control+y');
  await expect(textarea).toHaveValue('[] first\n[] ');

  await textarea.fill('[V] done');
  await textarea.press('End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('[V] done\n[] ');

  await textarea.fill('    [V] done');
  await textarea.press('End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('    [V] done\n    [] ');

  await textarea.fill('[] beforeafter');
  await textarea.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) {
      element.setSelectionRange('[] before'.length, '[] before'.length);
    }
  });
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('[] before\n[] after');

  await textarea.fill('[] ');
  await textarea.press('End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('');

  await textarea.fill('    [] ');
  await textarea.press('End');
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('    ');
});

test('JSON pair Enter expands the structure and Tab indents a blank line', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');

  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^JSON$/ }).click();

  const textarea = page.getByTestId('editor-textarea');
  await textarea.fill('{}');
  await textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(1, 1);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('{\n    \n}');
  await expect.poll(() => textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    return { start: textareaElement.selectionStart, end: textareaElement.selectionEnd };
  })).toEqual({ start: 6, end: 6 });

  await textarea.press('Control+z');
  await expect(textarea).toHaveValue('{}');
  await expect.poll(() => textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    return { start: textareaElement.selectionStart, end: textareaElement.selectionEnd };
  })).toEqual({ start: 1, end: 1 });
  await textarea.press('Control+y');
  await expect(textarea).toHaveValue('{\n    \n}');

  const nestedSource = '{"value": {}}';
  await textarea.fill(nestedSource);
  await textarea.evaluate((element, caret) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(caret, caret);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  }, nestedSource.indexOf('}'));
  await textarea.press('Enter');
  await expect(textarea).toHaveValue('{"value": {\n    \n}}');

  await textarea.fill('{\n\n}');
  await textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(2, 2);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await textarea.press('Tab');
  await expect(textarea).toHaveValue('{\n    \n}');
  await expect.poll(() => textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    return { start: textareaElement.selectionStart, end: textareaElement.selectionEnd };
  })).toEqual({ start: 6, end: 6 });
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue('{\n\n}');
});

test('a collapsed render caret highlights both ends of its bracket or quote pair', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await page.waitForLoadState('networkidle');

  const textarea = page.getByTestId('editor-textarea');
  const pairDecorations = page.locator('.render-pair-decoration');
  const getPairHighlightOffsets = () => pairDecorations.evaluateAll((elements) => elements
    .map((element) => Number(element.getAttribute('data-pair-offset')))
    .sort((left, right) => left - right));
  /** @param {number} offset */
  const setCaret = (offset) => textarea.evaluate((element, nextOffset) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(nextOffset, nextOffset);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  }, offset);

  const content = 'outer ({["value"]}) end';
  await textarea.fill(content);

  await setCaret(content.indexOf('(') + 1);
  await expect.poll(getPairHighlightOffsets).toEqual([content.indexOf('('), content.lastIndexOf(')')]);
  const decorationMetrics = await pairDecorations.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderBottomWidth: style.borderBottomWidth,
      height: rect.height,
      width: rect.width
    };
  }));
  expect(decorationMetrics).toHaveLength(2);
  expect(decorationMetrics.every((metric) => (
    metric.backgroundColor !== 'rgba(0, 0, 0, 0)'
    && metric.borderBottomWidth === '1px'
    && metric.height > 0
    && metric.width > 0
  ))).toBe(true);

  await setCaret(content.indexOf(']'));
  await expect.poll(getPairHighlightOffsets).toEqual([content.indexOf('['), content.indexOf(']')]);

  await setCaret(content.lastIndexOf('"'));
  await expect.poll(getPairHighlightOffsets).toEqual([content.indexOf('"'), content.lastIndexOf('"')]);

  const quotedBrackets = '"([{}])"';
  await textarea.fill(quotedBrackets);
  await setCaret(2);
  await expect.poll(getPairHighlightOffsets).toEqual([]);

  await setCaret(1);
  await expect.poll(getPairHighlightOffsets).toEqual([0, quotedBrackets.length - 1]);

  await textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(0, textareaElement.value.length);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect.poll(getPairHighlightOffsets).toEqual([]);

  await textarea.evaluate((element) => {
    const textareaElement = /** @type {HTMLTextAreaElement} */ (element);
    textareaElement.setSelectionRange(1, 1);
    textareaElement.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect.poll(getPairHighlightOffsets).toEqual([0, quotedBrackets.length - 1]);
  await page.locator('.render-mode-toggle').click();
  await expect.poll(getPairHighlightOffsets).toEqual([]);
  await expect(textarea).toHaveValue(quotedBrackets);
});

// 표시 줄 높이와 포인터 원문 위치가 편집 후에도 같은 배치를 사용하는지 확인한다.
test('wrapped comments retain measured heights after edits and pointer selection follows rendered text', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^JSONC$/ }).click();
  const textarea = page.getByTestId('editor-textarea');
  const first = '// ' + 'alpha-beta-한글 '.repeat(35);
  const second = '// ' + 'comment-value '.repeat(30);
  const source = first + '\n' + second + '\n{}';
  await textarea.fill(source);
  await textarea.press('Control+Home');
  await expect(page.locator('.hl-comment').first()).toBeVisible();
  const assertNoOverlap = async () => {
    await expect.poll(() => page.locator('.backdrop-line').evaluateAll(lines => {
      const rects = lines.map(line => line.getBoundingClientRect());
      return rects.slice(1).every((rect, i) => Math.abs(rect.top - rects[i].bottom) <= 0.5);
    })).toBe(true);
  };
  await assertNoOverlap();
  await textarea.press('x');
  await assertNoOverlap();
  await textarea.press('Control+z');
  await expect(textarea).toHaveValue(source);
  await assertNoOverlap();

  // 브라우저가 실제로 배치한 글자의 중심을 클릭한다.
  /** @param {number} lineIndex @param {number} offset */
  const pointAt = async (lineIndex, offset) => page.locator(`.backdrop-line[data-line-index="${lineIndex}"] .line-content`).evaluate((root, offset) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset >= (node.textContent ?? "").length) {
      offset -= (node.textContent ?? "").length;
      node = walker.nextNode();
    }
    if (!node) throw new Error('검증할 렌더 글자가 없음');
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 0.5, y: rect.top + rect.height / 2 };
  }, offset);
  const start = await pointAt(0, 130);
  const end = await pointAt(1, 40);
  await page.mouse.click(start.x, start.y);
  await expect.poll(() => textarea.evaluate(e => /** @type {HTMLTextAreaElement} */ (e).selectionStart)).toBe(130);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  // 마우스 버튼을 놓기 전부터 원문 선택과 실제 강조가 보여야 한다.
  await expect.poll(() => textarea.evaluate(e => { const input = /** @type {HTMLTextAreaElement} */ (e); return [input.selectionStart, input.selectionEnd]; }))
    .toEqual([130, first.length + 1 + 40]);
  await expect(page.locator('.editor-area')).toHaveClass(/render-custom-selection/);
  await expect.poll(() => page.evaluate(() => CSS.highlights.get('render-selection')?.size ?? 0)).toBeGreaterThan(0);
  await page.screenshot({ path: 'output/playwright/drag-selection-held.png' });
  await page.mouse.up();
  await expect.poll(() => textarea.evaluate(e => { const input = /** @type {HTMLTextAreaElement} */ (e); return [input.selectionStart, input.selectionEnd]; }))
    .toEqual([130, first.length + 1 + 40]);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => textarea.evaluate(e => { const input = /** @type {HTMLTextAreaElement} */ (e); return [input.selectionStart, input.selectionEnd, input.selectionDirection]; }))
    .toEqual([130, first.length + 1 + 40, 'backward']);
  await expect(textarea).toHaveValue(source);
  await page.setViewportSize({ width: 650, height: 650 });
  await assertNoOverlap();
});


test('render theme settings expose comments and added colors for both themes', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.setContent(await readFile(new URL('./fixtures/settings-preview.html', import.meta.url), 'utf8'));
  await page.getByRole('button', { name: '모양', exact: true }).nth(1).click();
  await expect(page.locator('input[type="color"]')).toHaveCount(32);
  await expect(page.locator('#color-hl-comment-window-light')).toHaveValue('#475569');
  const selection = page.locator('#color-selection-window-light');
  await expect(selection).toHaveValue('#60A5FA');
  await page.locator('#color-selection-window-light-picker').evaluate(element => {
    const input = /** @type {HTMLInputElement} */ (element);
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(selection).toHaveValue('#FF0000');
  await page.getByRole('button', { name: '다크', exact: true }).click();
  await expect(page.locator('#color-selection-window-dark')).toHaveValue('#60A5FA');
  await expect(page.locator('#color-hl-comment-window-dark')).toHaveValue('#64748B');
  await page.getByRole('button', { name: '라이트', exact: true }).click();
  await expect(selection).toHaveValue('#FF0000');
  await page.getByRole('button', { name: '기본 색상 복원', exact: true }).click();
  await expect(selection).toHaveValue('#60A5FA');
});

test('stored render colors reach comments, booleans, punctuation and selection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('text-pad.settings', JSON.stringify({
    format: 'text-pad-settings', schemaVersion: 1,
    settings: {
      general: { theme: 'light' },
      render: { colors: { light: {
        comment: '#123456', booleanTrueText: '#654321', booleanTrueBg: '#abcdef',
        mutedSyntax: '#112233', selection: '#ff0000', gutterText: '#445566'
      } } }
    }
  })));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('.new-document-format-trigger').click();
  await page.locator('.new-document-format-button').filter({ hasText: /^JSONC$/ }).click();
  const textarea = page.getByTestId('editor-textarea');
  await textarea.fill('// comment\n{"enabled":true}');
  await expect(page.locator('.hl-comment')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('.hl-boolean-true')).toHaveCSS('color', 'rgb(101, 67, 33)');
  await expect(page.locator('.hl-boolean-true')).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  await expect(page.locator('.hl-punctuation').first()).toHaveCSS('color', 'rgb(17, 34, 51)');
  await expect(page.locator('.gutter-line-number').first()).toHaveCSS('color', 'rgb(68, 85, 102)');
  await textarea.press('Control+a');
  await expect(page.locator('.editor-area')).toHaveClass(/render-custom-selection/);
  await expect(page.locator('.app-container')).toHaveCSS('--color-selection', '#FF0000');
  await page.reload();
  await expect(page.locator('.app-container')).toHaveCSS('--color-selection', '#FF0000');
});
