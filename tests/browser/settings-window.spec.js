// @ts-expect-error 브라우저 테스트는 Node에서 실행하지만 앱 타입 환경에는 Node 선언을 포함하지 않는다.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function openSettings(page, query = '') {
  const html = await readFile(new URL('./fixtures/settings-preview.html', import.meta.url), 'utf8');
  await page.unroute('**/__settings-preview*');
  await page.route('**/__settings-preview*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`/__settings-preview${query}`);
  await expect(page.locator('#settings-page-title')).toBeVisible();
  await expect(page.locator('.settings-body')).toHaveCSS('display', 'flex');
}

test('설정 범주는 접혀 시작하고 범주와 개별 형식을 구분해 탐색한다', async ({ page }) => {
  await openSettings(page);
  const navigation = page.getByRole('navigation');
  await expect(navigation.getByRole('button', { name: 'JSON', exact: true })).toHaveCount(0);
  await navigation.getByRole('button', { name: '구조화 데이터', exact: true }).click();
  await expect(page.locator('#settings-page-title')).toHaveText('구조화 데이터');
  await page.getByRole('main').getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(page.locator('#settings-page-title')).toHaveText('JSON');
  await expect(navigation.getByRole('button', { name: 'JSON', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('checkbox', { name: /^렌더 표시/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /^렌더 표시/ }).uncheck();
  await navigation.getByRole('button', { name: '일반', exact: true }).click();
  await navigation.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /^렌더 표시/ })).not.toBeChecked();
  await navigation.getByRole('button', { name: '구조화 데이터 펼치기 또는 접기', exact: true }).click();
  await expect(page.locator('#settings-page-title')).toHaveText('JSON');
  await expect(navigation.getByRole('button', { name: 'JSON', exact: true })).toHaveCount(0);
});

test('설정 검색은 숨은 항목과 확장자를 찾고 키보드로 이동하며 검색 해제 후 위치를 유지한다', async ({ page }) => {
  await openSettings(page);
  await page.keyboard.press('Control+f');
  const search = page.getByRole('searchbox', { name: '설정 검색' });
  await expect(search).toBeFocused();
  await search.fill('한글');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(1);
  await search.press('Enter');
  await expect(page.locator('#settings-page-title')).toHaveText('색상');
  const match = page.getByLabel('한글 색상', { exact: true });
  await expect(match).toBeInViewport();
  await expect(page.locator('.color-row.search-match')).toContainText('한글 색상');
  await search.fill('.yaml');
  await search.press('Enter');
  await expect(page.locator('#settings-page-title')).toHaveText('YAML');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'YAML', exact: true })).toHaveAttribute('aria-current', 'page');
  await search.fill('no-such-setting-123');
  await expect(page.getByText('검색 결과가 없습니다', { exact: true })).toBeVisible();
  await expect(page.locator('#settings-page-title')).toHaveText('YAML');
  await search.fill('render font');
  await expect(page.getByRole('navigation').getByRole('button')).not.toHaveCount(0);
  await search.press('ArrowDown');
  await expect(page.getByRole('navigation').getByRole('button').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('navigation').getByRole('button').last()).toBeFocused();
});

test('글자 크기 미리보기와 입력 보조 종속 항목이 설정값에 따라 바뀐다', async ({ page }) => {
  await openSettings(page);
  const navigation = page.getByRole('navigation');
  await navigation.getByRole('button', { name: '글꼴 설정', exact: true }).nth(1).click();
  await page.getByLabel('글꼴 크기 (pt)', { exact: true }).fill('18');
  await expect(page.locator('.preview-document')).toHaveCSS('font-size', '24px');
  await navigation.getByRole('button', { name: '편집', exact: true }).click();
  const autoPair = page.getByLabel('쌍을 이루는 문자 자동 삽입 및 삭제', { exact: false });
  await autoPair.uncheck();
  await expect(page.getByLabel('캐럿 오른쪽에 허용할 문자열')).toBeDisabled();
  await autoPair.check();
  await page.getByLabel('캐럿 오른쪽에 허용할 문자열').fill(';');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '허용 문자열 ; 제거', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: '글꼴 설정', exact: true }).nth(1).click();
  await expect(page.getByLabel('글꼴 크기 (pt)', { exact: true })).toHaveValue('18');
});

test('어두운 화면에서는 어두운 팔레트로 시작하며 그룹을 펼쳐도 별도 팔레트를 유지한다', async ({ page }) => {
  await openSettings(page, '?theme=dark');
  await page.getByRole('button', { name: '색상', exact: true }).click();
  await expect(page.getByRole('button', { name: '다크', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.editor-preview')).toHaveCSS('background-color', 'rgb(10, 10, 11)');
  await expect(page.getByLabel('한글 색상', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: /^문자 종류/ }).click();
  await expect(page.getByLabel('한글 색상', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '라이트', exact: true }).click();
  await expect(page.locator('.editor-preview')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(page.locator('body')).toHaveClass('theme-dark');
});

test('기본 크기와 좁은 창에서 주요 설정이 가로로 잘리지 않는다', async ({ page }) => {
  await openSettings(page);
  for (const size of [{ width: 800, height: 580 }, { width: 640, height: 520 }, { width: 1100, height: 740 }]) {
    await page.setViewportSize(size);
    for (const label of ['일반', '편집', '색상', '표', '설정 파일']) {
      await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect.poll(() => page.locator('.settings-navigation').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(page.getByText('변경 사항은 즉시 적용됩니다.', { exact: true })).toBeInViewport();
    }
    await page.getByRole('navigation').getByRole('button', { name: '문서', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect.poll(() => page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
});

test('영어와 오른쪽에서 왼쪽으로 쓰는 언어에서도 탐색과 검색이 동작한다', async ({ page }) => {
  await openSettings(page, '?locale=en');
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('comment');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('#settings-page-title')).toHaveText('Colors');
  await openSettings(page, '?locale=ar&theme=dark');
  await page.setViewportSize({ width: 800, height: 580 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('searchbox').fill('.csv');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('#settings-page-title')).toHaveText('CSV');
  await expect.poll(() => page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
