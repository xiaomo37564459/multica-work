/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 指挥舱前端的构建配置。
 *
 * - `@contract` 指向仓库根的 src/contract/types.ts —— 前端只认这一份契约,
 *   mock 数据用 `satisfies` 压在这些类型上,字段名错一个 typecheck 就红。
 * - `@pixel` 指向仓库根的 pixel/ —— 苏绘的皮肤和立绘直接 import,不复制副本。
 * - /api 代理到本机 BFF(127.0.0.1:4780)。走代理是同源请求,
 *   不需要动 BFF 的 COCKPIT_DEV_ORIGIN_PORTS 白名单。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contract': fileURLToPath(new URL('../src/contract/types.ts', import.meta.url)),
      '@pixel': fileURLToPath(new URL('../pixel', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 皮肤在仓库根的 pixel/ 下,允许 dev server 越出 web/ 一级去读它
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:4780', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    css: false,
    // 只认 .tsx 后缀的测试:根上的 `npm test` 是裸 `node --test` 全仓库自动发现,
    // 它按名认 *.test.ts/js(tsx 不认)。web 的测试归 vitest 跑,后缀错一个就会
    // 被两个 runner 抢 —— test/test-discovery.test.ts 和根 README 有全套规则。
    include: ['src/**/*.test.tsx'],
  },
});
