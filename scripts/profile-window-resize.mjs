// 로컬 앱의 창 크기 변경 CPU 표본과 브라우저 배치 시간을 기록한다.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const label = process.argv[2] || 'before';
const nativeRewrapControl = process.argv[3] === 'native-rewrap';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto('http://127.0.0.1:4173');
  await page.waitForLoadState('networkidle');
  if (nativeRewrapControl) {
    // 비교군: 같은 실시간 렌더 코드에서 입력창 전체도 매번 줄바꿈하도록 한다.
    await page.addStyleTag({ content: '.render-mode .editor-textarea { width: 100% !important; transform: none !important; }' });
  }
  const content = Array.from({ length: 1800 }, (_, i) => `${i}: 창 크기를 변경할 때 줄바꿈과 선택 위치를 확인합니다. ${'mixed text 123 '.repeat(8)}`).join('\n');
  await page.getByTestId('editor-textarea').fill(content);
  await page.getByTestId('editor-textarea').press('Control+Home');
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  const results = [];
  await mkdir('output/playwright/resize-profile', { recursive: true });
  for (const mode of ['diagonal', 'width', 'height']) {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForTimeout(400);
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    await cdp.send('Profiler.start');
    const start = performance.now();
    for (let i = 0; i < 60; i++) {
      const step = i < 30 ? i : 60 - i;
      await page.setViewportSize({ width: mode === 'height' ? 1000 : 1000 - step * 10, height: mode === 'width' ? 700 : 700 - step * 5 });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(400);
    const { profile } = await cdp.send('Profiler.stop');
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const metrics = Object.fromEntries(after.filter(m => /Duration|LayoutCount|RecalcStyleCount/.test(m.name)).map(m => [m.name, m.value - (before.find(b => b.name === m.name)?.value || 0)]));
    const counts = new Map();
    for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
    const hot = profile.nodes.map(n => ({ name: n.callFrame.functionName, url: n.callFrame.url, line: n.callFrame.lineNumber + 1, samples: counts.get(n.id) || 0 })).sort((a,b) => b.samples - a.samples).slice(0,20);
    results.push({ mode, nativeRewrapControl, elapsedMs: performance.now() - start, metrics, hot });
    await writeFile(`output/playwright/resize-profile/${label}-${mode}.cpuprofile`, JSON.stringify(profile));
  }
  await writeFile(`output/playwright/resize-profile/${label}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map(({ hot, ...summary }) => summary), null, 2));
} finally {
  await browser.close();
}
