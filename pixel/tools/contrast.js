/**
 * 对比度体检 —— 按 WCAG 2.1 算 tokens.css 里那些「字压在底色上」的组合。
 *
 *   node pixel/tools/contrast.js        列出全部组合,不合格的标 FAIL
 *   node pixel/tools/contrast.js --fail 有不合格就以非 0 退出(给 CI 用)
 *
 * 为什么单独做成一个文件:加主题、调色值的人需要当场能算一遍,
 * 不该逼他去翻测试代码。sprites.test.js 直接 import 这里的函数,
 * 所以「工具算出来的」和「测试卡的」永远是同一套数。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** WCAG 相对亮度 */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** 两色对比度,1~21。正文要 ≥ 4.5,大字和图形要 ≥ 3 */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const AA_TEXT = 4.5;

/** 从 tokens.css 里把每套主题的变量抠出来 */
export function readThemes(css) {
  const themes = {};
  for (const name of ['deep-space', 'dusk-forge', 'tactical-board']) {
    const sel = `[data-theme="${name}"]`;
    let at = -1;
    // 选择器可能出现在注释里,只认后面紧跟 { 的那次
    for (let i = css.indexOf(sel); i > -1; i = css.indexOf(sel, i + 1)) {
      if (/^\s*\{/.test(css.slice(i + sel.length))) { at = i; break; }
    }
    if (at < 0) continue;
    const block = css.slice(at, css.indexOf('}', at));
    const vars = {};
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2].toLowerCase();
    themes[name] = vars;
  }
  return themes;
}

/**
 * 需要体检的组合。每条 = 「什么字」压在「什么底」上,以及为什么它得合格。
 * 加了新的「文字压底色」用法,就往这里加一条。
 */
export const CHECKS = [
  { fg: '--pc-text-dim', bgs: ['--pc-bg-0', '--pc-bg-1', '--pc-bg-2', '--pc-bg-3', '--pc-bg-sunken'],
    why: '次要信息(「待命中·没有在打的怪」「今日 3 战 3 胜」、输入框 placeholder)' },
  { fg: '--pc-text', bgs: ['--pc-bg-0', '--pc-bg-1', '--pc-bg-2', '--pc-bg-3'],
    why: '正文' },
  { fg: '--pc-text-hi', bgs: ['--pc-bg-0', '--pc-bg-1', '--pc-bg-2', '--pc-bg-3'],
    why: '标题和关键数字' },
  { fg: '#ffffff', bgs: ['--pc-danger-bg'],
    why: '「中止任务」按钮的白字 —— 销毁性操作,看不清就是事故' },
  { fg: '--pc-text-on-accent', bgs: ['--pc-accent'],
    why: '主按钮(派活)的字' },
];

/** 跑一遍全部组合,返回逐条结果 */
export function audit(themes) {
  const rows = [];
  for (const [theme, v] of Object.entries(themes)) {
    for (const c of CHECKS) {
      const fg = c.fg.startsWith('#') ? c.fg : v[c.fg];
      if (!fg) continue;
      for (const bgName of c.bgs) {
        const bg = v[bgName];
        if (!bg) continue;
        const ratio = contrast(fg, bg);
        rows.push({ theme, fg: c.fg, bg: bgName, fgHex: fg, bgHex: bg, ratio, pass: ratio >= AA_TEXT, why: c.why });
      }
    }
  }
  return rows;
}

/* ---------------- CLI ---------------- */

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('contrast.js')) {
  const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
  const rows = audit(readThemes(css));
  let bad = 0;
  let theme = '';
  for (const r of rows) {
    if (r.theme !== theme) { theme = r.theme; console.log(`\n── ${theme} ──`); }
    if (!r.pass) bad++;
    const tag = r.pass ? 'ok  ' : 'FAIL';
    console.log(`  ${tag} ${r.ratio.toFixed(2).padStart(5)}  ${r.fg} (${r.fgHex}) 压 ${r.bg} (${r.bgHex})`);
  }
  console.log(`\n共 ${rows.length} 组,${bad} 组不到 ${AA_TEXT}`);
  if (bad && process.argv.includes('--fail')) process.exit(1);
}
