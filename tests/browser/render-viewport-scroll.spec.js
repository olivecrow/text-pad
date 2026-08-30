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
