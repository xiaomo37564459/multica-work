import { defineConfig, devices } from '@playwright/test';

/**
 * 主流程冒烟的配置。
 *
 * 打的是**真的那一份**:`npm start` 起来的指挥舱(BFF 自己端界面,同源 127.0.0.1:4780),
 * 真数据、真轮询。不打 Vite 开发服,也不吃 mock —— 冒烟要是跑在演示数据上,
 * 它能证明的就只有「界面会渲染」,证明不了「今天早上打开是好的」。
 *
 * 已经手动起着服务时会直接复用(reuseExistingServer),不会另起一个来抢端口。
 */
export default defineConfig({
  testDir: '.',
  // 后缀用 .spec.ts:仓库根的 `npm test` 是裸 `node --test` 全仓库自动发现,
  // 它按名字认 *.test.ts —— 撞上就会被 node 抢着跑然后当场红(规则见根 README)。
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // 打的是同一个真服务,并行只会互相干扰
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'report', open: 'never' }]],
  use: {
    baseURL: process.env.COCKPIT_URL ?? 'http://127.0.0.1:4780',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm start',
    cwd: '..',
    url: 'http://127.0.0.1:4780/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
