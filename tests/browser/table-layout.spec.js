import { expect, test } from '@playwright/test';

const longValue = '긴 내용은 셀 너비에 맞춰 자동으로 줄바꿈되어야 합니다. '.repeat(12)
  + 'LongUnbrokenText'.repeat(12);

/** @param {string} format @param {string[][]} rows */
function tableSource(format, rows) {
  if (format !== 'Markdown') return rows.map(row => row.join(format === 'CSV' ? ',' : '\t')).join('\n');
  return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
}

/** @param {import('@playwright/test').Page} page @param {string} format @param {string[][]} rows */
async function openTable(page, format, rows) {
  await page.goto('/');
  if (format !== 'Markdown') {
    await page.locator('.new-document-format-trigger').click();
    await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    await page.locator('.render-mode-toggle').click();
  }
  await page.getByTestId('editor-textarea').fill(tableSource(format, rows));
  if (format !== 'Markdown') await page.locator('.render-mode-toggle').click();
}

for (const format of ['Markdown', 'CSV', 'TSV']) {
  test(`${format} softens text-based column widths and preserves manual width choices`, async ({ page }) => {
    // 합계 글자 수 4:12:0. 빈 열에는 최소 너비를, 나머지에는 1:√3의 너비를 배분한다.
    await openTable(page, format, [['aa', 'bbbbbb', ''], ['cc', 'dddddd', '']]);
    const surface = page.locator('.table-editor');
    const widths = () => surface.locator('th[data-table-column-container]').evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().width));
    await expect.poll(async () => (await widths())[1] / (await widths())[0]).toBeCloseTo(Math.sqrt(3), 1);
    await expect.poll(async () => (await widths())[2]).toBeCloseTo(100, 0);

    // 행 이동과 달리 열 이동은 글자 수 비율도 해당 열을 따라간다.
    await surface.locator('.column-drag-handle').first().press('Alt+ArrowRight');
    await expect.poll(async () => (await widths())[0] / (await widths())[1]).toBeCloseTo(Math.sqrt(3), 1);
    const editedCell = surface.locator('[data-table-row="1"][data-table-column="1"]');
    await editedCell.fill('x'.repeat(120));
    await expect.poll(async () => (await widths())[1] / (await widths())[0]).toBeCloseTo(Math.sqrt(122 / 12), 1);

    const beforeManual = await widths();
    // 두 번째 열의 왼쪽 경계를 옮겨 첫 번째 열에 32픽셀을 더한다.
    await surface.locator('.column-resize-handle').first().press('Shift+ArrowRight');
    await expect.poll(async () => (await widths())[0] - beforeManual[0]).toBeCloseTo(32, 0);
    const manual = await widths();
    await editedCell.fill('x');
    await expect.poll(widths).toEqual(manual);

    await page.setViewportSize({ width: 460, height: 650 });
    await expect.poll(async () => (await widths()).every(width => width >= 99.99)).toBe(true);
    await expect.poll(() => surface.locator('.data-table').evaluate(el => el.getBoundingClientRect().width)).toBe(500);
    // 키보드로 계속 줄여도 데이터 열의 최소 너비는 100픽셀이다.
    for (let count = 0; count < 10; count += 1) {
      await surface.locator('.column-resize-handle').first().press('Shift+ArrowLeft');
    }
    await expect.poll(async () => (await widths())[0]).toBeCloseTo(100, 0);
    await page.setViewportSize({ width: 1200, height: 650 });
    await expect.poll(async () => (await widths())[0]).toBeGreaterThan(100);
  });

  test(`${format} scrolls horizontally when columns cannot fit at 100px each`, async ({ page }) => {
    await page.setViewportSize({ width: 460, height: 650 });
    const row = Array(12).fill('x');
    await openTable(page, format, [row, row]);
    const surface = page.locator('.table-editor');
    await expect.poll(() => surface.locator('th[data-table-column-container]').evaluateAll(elements =>
      elements.every(element => element.getBoundingClientRect().width >= 99.99))).toBe(true);
    await expect.poll(() => surface.locator('.data-table').evaluate(el => el.getBoundingClientRect().width)).toBe(1243);
    await expect.poll(() => surface.locator('.table-scroll-region').evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  });

  test(`${format} tables fill available width, wrap cells and share the tallest row height`, async ({ page }) => {
    await page.goto('/');
    if (format === 'Markdown') {
      await page.getByTestId('editor-textarea').fill('before\n\n| Name | Description |\n| --- | --- |\n| short | value |\n\nafter');
    } else {
      await page.locator('.new-document-format-trigger').click();
      await page.locator('.new-document-format-button').filter({ hasText: new RegExp(`^${format}$`) }).click();
    }
    const surface = page.locator('.table-editor');
    const table = surface.locator('.data-table');
    await surface.locator('[data-table-row="0"][data-table-column="0"]').fill('긴 머리글도 너비에 맞춰 줄바꿈합니다. '.repeat(5));
    const longCell = surface.locator('[data-table-row="1"][data-table-column="0"]');
    const shortCell = surface.locator('[data-table-row="1"][data-table-column="1"]');
    await longCell.fill(longValue);
    await shortCell.fill('short\n\n');

    const layout = () => surface.evaluate((element) => {
      const region = element.querySelector('.table-scroll-region');
      const table = element.querySelector('.data-table');
      if (!region || !table) throw new Error('표 배치 요소를 찾을 수 없습니다.');
      const style = getComputedStyle(region);
      return {
        width: table.getBoundingClientRect().width,
        available: region.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        overflow: region.scrollWidth - region.clientWidth
      };
    });
    const cellsFit = () => surface.locator('.table-cell-editor').evaluateAll((elements) => elements.every((cell) => {
      const row = cell.closest('tr');
      return row !== null && cell.scrollWidth <= cell.clientWidth + 1
        && cell.scrollHeight <= cell.clientHeight + 1
        && Math.abs(cell.getBoundingClientRect().height - row.getBoundingClientRect().height) <= 2;
    }));

    for (const width of [1200, 700]) {
      await page.setViewportSize({ width, height: 850 });
      await expect.poll(async () => {
        const measured = await layout();
        return Math.abs(measured.width - measured.available);
      }).toBeLessThan(1);
      await expect.poll(cellsFit).toBe(true);
      await expect.poll(async () => (await layout()).overflow).toBe(0);
    }
    const wideHeight = await longCell.evaluate((cell) => cell.getBoundingClientRect().height);
    await page.setViewportSize({ width: 460, height: 850 });
    await expect.poll(async () => (await layout()).width).toBe(500);
    await expect.poll(async () => (await layout()).overflow).toBeGreaterThan(0);
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(() => longCell.evaluate((cell) => cell.getBoundingClientRect().height)).toBeGreaterThan(wideHeight);
    await expect(longCell).toHaveValue(longValue);

    await page.setViewportSize({ width: 1200, height: 850 });
    await expect.poll(async () => Math.abs((await layout()).width - (await layout()).available)).toBeLessThan(1);
    const widthBefore = await longCell.evaluate((cell) => cell.getBoundingClientRect().width);
    await surface.locator('.column-resize-handle').first().press('Shift+ArrowLeft');
    await expect.poll(async () => (await longCell.evaluate((cell) => cell.getBoundingClientRect().width)) - widthBefore)
      .toBeCloseTo(-32, 0);
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(async () => Math.abs((await layout()).width - (await layout()).available)).toBeLessThan(1);

    const tallHeight = await longCell.evaluate((cell) => cell.getBoundingClientRect().height);
    await longCell.fill('short');
    await expect.poll(cellsFit).toBe(true);
    await expect.poll(() => longCell.evaluate((cell) => cell.getBoundingClientRect().height)).toBeLessThan(tallHeight);
    await expect(shortCell).toHaveValue('short\n\n');
    await longCell.press('Control+z');
    await expect(longCell).toHaveValue(longValue);
    await expect.poll(cellsFit).toBe(true);
    await expect(table).toBeVisible();
    await page.locator('.render-mode-toggle').click();
    await expect.poll(() => page.getByTestId('editor-textarea').inputValue()).toContain(longValue);
  });
}
