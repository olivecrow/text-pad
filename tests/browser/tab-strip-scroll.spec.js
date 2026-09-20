import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function openOverflowingTabs(page) {
  await page.goto('/');
  for (let index = 0; index < 9; index += 1) {
    await page.getByRole('button', { name: /^(새 탭|New tab)$/ }).click();
  }
  const strip = page.getByRole('tablist');
  await expect(page.getByRole('tab')).toHaveCount(10);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await strip.hover();
  return strip;
}

test('ordinary vertical wheel scrolls tabs in both directions and horizontal wheel still works', async ({ page }) => {
  const strip = await openOverflowingTabs(page);
  const end = await strip.evaluate(el => el.scrollLeft);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeCloseTo(end - 240, 0);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeCloseTo(end - 120, 0);
  await page.mouse.wheel(-100, 0);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeCloseTo(end - 220, 0);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 80);
  await page.keyboard.up('Shift');
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBeCloseTo(end - 140, 0);
});

test('manual tab scroll survives editor updates while new tabs and explicit selection still reveal tabs', async ({ page }) => {
  const strip = await openOverflowingTabs(page);
  await page.mouse.wheel(-10000, 0);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);

  const editor = page.getByTestId('editor-textarea');
  await editor.fill(Array.from({ length: 100 }, (_, index) => `본문 ${index}`).join('\n'));
  await editor.press('Control+End');
  await editor.press('ArrowLeft');
  // 늦게 실행되는 자동 노출까지 포함해 정지 후 위치를 확인한다.
  await page.waitForTimeout(300);
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);

  await page.getByRole('button', { name: /^(새 탭|New tab)$/ }).click();
  await expect.poll(() => strip.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft)).toBeLessThan(2);
  await page.getByRole('tab').first().click();
  await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
});
