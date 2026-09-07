/**
 * 像素资产的契约测试。零依赖,用 Node 自带的 test runner:
 *
 *   node --test pixel/tests/
 *
 * 测的不是「好不好看」(那得人看),而是几条会悄悄坏掉的硬约束 ——
 * 加角色、改配色、改姿势时最容易踩的就是这些。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ROSTER, unitColors } from '../sprites/roster.js';
import { HEADS, OUTFITS, PROPS } from '../sprites/parts.js';
import { drawSprite, STATES, FRAMES, STATE_FROM_CONTRACT, toSpriteState } from '../sprites/renderer.js';
import { INK, ramp, despair, drained } from '../sprites/palette.js';
import { G } from '../sprites/body.js';
import { audit, readThemes, contrast, AA_TEXT } from '../tools/contrast.js';

const TOKENS = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
const COMPONENTS = readFileSync(fileURLToPath(new URL('../components.css', import.meta.url)), 'utf8');

/** MTM-275 数据契约里的 BattleState。改契约就得同步改这里,测试会挡住。 */
const CONTRACT_STATES = ['fighting', 'stalled', 'defeated', 'idle', 'offline', 'unknown'];

const cells = (g) => g.d.filter(Boolean).length;
const signature = (g) => g.d.map((c) => c || '.').join('|');

/* ---------------- 名册本身 ---------------- */

test('名册 key 和 agentId 都不重复', () => {
  assert.equal(new Set(ROSTER.map((c) => c.key)).size, ROSTER.length);
  assert.equal(new Set(ROSTER.map((c) => c.agentId)).size, ROSTER.length);
});

test('13 个角色都在', () => {
  assert.equal(ROSTER.length, 13);
});

test('每条记录引用的部件都真实存在', () => {
  for (const c of ROSTER) {
    assert.ok(HEADS[c.head], `${c.name} 的头饰 ${c.head} 不存在`);
    assert.ok(OUTFITS[c.outfit], `${c.name} 的服装 ${c.outfit} 不存在`);
    assert.ok(PROPS[c.prop], `${c.name} 的道具 ${c.prop} 不存在`);
  }
});

test('agentId 是合法 uuid —— 填错了立绘就对不上真实智能体', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const c of ROSTER) assert.match(c.agentId, uuid, `${c.name} 的 agentId 不合法`);
});

/* ---------------- 名册与 token 必须同步 ----------------
   卡片顶条的颜色来自 tokens.css,立绘衣服的颜色来自名册。
   两边漂了,就会出现「卡片是灰的、人是蓝的」。 */

test('每个角色的身份色都和 tokens.css 里的 --pc-unit-<key> 一致', () => {
  for (const c of ROSTER) {
    const m = TOKENS.match(new RegExp(`--pc-unit-${c.key}\\s*:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `tokens.css 里缺 --pc-unit-${c.key}`);
    assert.equal(m[1].toLowerCase(), c.unit.toLowerCase(),
      `${c.name}:名册是 ${c.unit},tokens.css 是 ${m[1]}`);
  }
});

test('道具色和衣服色不能是同一个 —— 一样就糊成一坨', () => {
  for (const c of ROSTER) {
    assert.notEqual((c.propColor || c.unit).toLowerCase(), c.unit.toLowerCase(),
      `${c.name} 的道具和衣服同色`);
  }
});

/* ---------------- 渲染 ---------------- */

test('104 张立绘全部画得出来,且都在 32×32 画布内', () => {
  let n = 0;
  for (const c of ROSTER) {
    for (const st of STATES) {
      for (let f = 0; f < FRAMES; f++) {
        const g = drawSprite(c, st, f);
        assert.equal(g.n, G);
        assert.equal(g.d.length, G * G);
        assert.ok(cells(g) > 200, `${c.name}/${st}/${f} 画出来几乎是空的`);
        n++;
      }
    }
  }
  assert.equal(n, 13 * 4 * 2);
});

test('描边色全场只有一个 —— 这是画风统一的根,破了就是 13 套画风', () => {
  for (const c of ROSTER) {
    const g = drawSprite(c, 'idle', 0);
    // 画布边缘一圈一定是描边(或空),不该出现别的颜色
    for (let i = 0; i < G; i++) {
      for (const [x, y] of [[i, 0], [i, G - 1], [0, i], [G - 1, i]]) {
        const v = g.get(x, y);
        if (v) assert.equal(v, INK, `${c.name} 在 (${x},${y}) 的边缘像素不是描边色`);
      }
    }
  }
});

/* ---------------- 四态必须真的不一样 ----------------
   验收标准写的是「4 个状态不靠文字也能一眼分清」。
   一眼分不分得清得人看,但「像素完全一样」是能测的,而且是最容易回归的地方 ——
   改姿势表时手一抖把两个状态写成同一组偏移,肉眼很难发现。 */

test('同一个角色的四个状态两两都不同', () => {
  for (const c of ROSTER) {
    const sigs = STATES.map((st) => signature(drawSprite(c, st, 0)));
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        assert.notEqual(sigs[i], sigs[j], `${c.name}:${STATES[i]} 和 ${STATES[j]} 画出来一模一样`);
      }
    }
  }
});

test('四态的差异不是只差几个像素 —— 至少 8% 的格子要变', () => {
  for (const c of ROSTER) {
    const base = drawSprite(c, 'idle', 0).d;
    for (const st of ['working', 'stuck', 'failed']) {
      const other = drawSprite(c, st, 0).d;
      const diff = base.reduce((n, v, i) => n + (v === other[i] ? 0 : 1), 0);
      assert.ok(diff > G * G * 0.08,
        `${c.name}:${st} 和 idle 只差 ${diff} 格,离远了分不出来`);
    }
  }
});

test('工作态两帧不同,否则动画是静止的', () => {
  for (const c of ROSTER) {
    assert.notEqual(signature(drawSprite(c, 'working', 0)), signature(drawSprite(c, 'working', 1)),
      `${c.name} 的工作态两帧一样,动不起来`);
  }
});

/* ---------------- 角色之间必须认得出谁是谁 ---------------- */

test('13 个角色的空闲立绘两两不同', () => {
  const seen = new Map();
  for (const c of ROSTER) {
    const sig = signature(drawSprite(c, 'idle', 0));
    const dup = seen.get(sig);
    assert.equal(dup, undefined, `${c.name} 和 ${dup} 长得一模一样`);
    seen.set(sig, c.name);
  }
});

test('失败态仍然认得出是谁 —— 压暗不能把人压成同一团', () => {
  const sigs = ROSTER.map((c) => signature(drawSprite(c, 'failed', 0)));
  assert.equal(new Set(sigs).size, ROSTER.length, '有角色的失败态画得完全一样');

  // 再确认压暗之后还保留了色相差异:两个色相差很远的角色不该变成同一个颜色
  const a = despair(ROSTER.find((c) => c.key === 'shen').unit);   // 紫
  const b = despair(ROSTER.find((c) => c.key === 'qin').unit);    // 绿
  assert.notEqual(a, b, '失败态把所有身份色压成同一个颜色了,看不出谁挂了');
});

/* ---------------- 配色推导 ---------------- */

test('ramp() 给出的四档由暗到亮单调递增', () => {
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
  };
  for (const c of ROSTER) {
    const r = ramp(c.unit);
    assert.ok(lum(r.dark) < lum(r.mid), `${c.name}: dark 不比 mid 暗`);
    assert.ok(lum(r.mid) < lum(r.base), `${c.name}: mid 不比 base 暗`);
    assert.ok(lum(r.base) < lum(r.light), `${c.name}: base 不比 light 暗`);
  }
});

test('despair 一定压暗,drained 一定降饱和', () => {
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = (h) => { const [r, g, b] = rgb(h); return 0.3 * r + 0.59 * g + 0.11 * b; };
  const sat = (h) => { const c = rgb(h); return Math.max(...c) - Math.min(...c); };
  for (const c of ROSTER) {
    assert.ok(lum(despair(c.unit)) < lum(c.unit), `${c.name}: 失败态没变暗`);
    assert.ok(sat(drained(c.unit)) < sat(c.unit), `${c.name}: 卡住态没降饱和`);
  }
});

test('每个角色展开出来的配色都齐全', () => {
  for (const c of ROSTER) {
    const col = unitColors(c);
    for (const k of ['cloth', 'pants', 'prop', 'skin']) {
      for (const t of ['dark', 'mid', 'base', 'light']) {
        assert.match(col[k][t], /^#[0-9a-f]{6}$/i, `${c.name} 的 ${k}.${t} 不是合法色值`);
      }
    }
  }
});

/* ---------------- tokens.css 自身 ---------------- */

test('三套主题都定义了完整的四个状态色', () => {
  for (const theme of ['deep-space', 'dusk-forge', 'tactical-board']) {
    const block = theme === 'deep-space'
      ? TOKENS.slice(TOKENS.indexOf('[data-theme="deep-space"]'), TOKENS.indexOf('[data-theme="dusk-forge"]'))
      : TOKENS.slice(TOKENS.indexOf(`[data-theme="${theme}"]`), TOKENS.indexOf(`[data-theme="${theme}"]`) + 1400);
    for (const st of ['working', 'idle', 'stuck', 'failed']) {
      assert.match(block, new RegExp(`--pc-st-${st}\\s*:\\s*#[0-9a-fA-F]{6}`), `${theme} 缺 --pc-st-${st}`);
    }
  }
});

/* ---------------- 与数据契约对齐 ----------------
   契约在 MTM-275 的 src/contract/types.ts。它有 6 个状态,立绘只有 4 套姿势,
   中间这层映射一旦漏一个,前端就会拿到 undefined 然后白屏。 */

test('契约里的 6 个状态每一个都能映射到立绘状态', () => {
  for (const st of CONTRACT_STATES) {
    assert.ok(STATES.includes(toSpriteState(st)), `契约状态 ${st} 映射不出立绘状态`);
  }
  assert.deepEqual(Object.keys(STATE_FROM_CONTRACT).sort(), [...CONTRACT_STATES].sort());
});

test('没见过的状态一律退回空闲,绝不返回 undefined', () => {
  for (const junk of ['', null, undefined, 'RUNNING', '打怪中', 42]) {
    assert.equal(toSpriteState(junk), 'idle', `${String(junk)} 没有安全兜底`);
  }
});

test('立绘自己的四个状态名传进来也认(本地写假数据时不用先查表)', () => {
  for (const st of STATES) assert.equal(toSpriteState(st), st);
});

test('契约 6 态都有对应的状态灯样式和状态色,不然会渲染成没有样式的空盒子', () => {
  const lamps = ['working', 'idle', 'stuck', 'failed', 'offline', 'unknown'];
  for (const st of lamps) {
    assert.match(COMPONENTS, new RegExp(`\\.pc-lamp--${st}\\b`), `components.css 缺 .pc-lamp--${st}`);
    const hits = TOKENS.match(new RegExp(`--pc-st-${st}\\s*:`, 'g')) || [];
    assert.equal(hits.length, 3, `--pc-st-${st} 应该三套主题各定义一次,实际 ${hits.length} 次`);
  }
});

/* ---------------- 默认主题 ----------------
   heory 在 MTM-276 定了 A 深空指挥舱。这个决定只写在注释里靠不住 ——
   有人把 A 的值从 :root 挪进 [data-theme="deep-space"]、或者改了样张页的
   data-theme,默认就悄悄变了,没人会发现。这两条测试把决定钉死。 */

test('A 深空指挥舱是默认主题:它的值必须直接挂在 :root 上', () => {
  const m = TOKENS.match(/:root,\s*\n\[data-theme="deep-space"\]\s*\{/);
  assert.ok(m, ':root 和 [data-theme="deep-space"] 必须共用同一个块,否则不写 data-theme 就没有主题色');

  // 另外两套只能各自挂在自己的 data-theme 上,不许也蹭到 :root。
  // 逐个块地取「{ 之前那段选择器」来看,比拼正则可靠。
  for (const t of ['dusk-forge', 'tactical-board']) {
    const at = TOKENS.indexOf(`[data-theme="${t}"]`);
    assert.ok(at > -1, `tokens.css 里没有 ${t} 这套主题`);
    const selector = TOKENS.slice(TOKENS.lastIndexOf('*/', at) + 2, TOKENS.indexOf('{', at));
    assert.ok(!selector.includes(':root'),
      `${t} 是备选主题,不该和 :root 共用选择器(现在是 "${selector.trim()}")`);
  }
});

test('样张页开局用的就是选定的那套主题', () => {
  const html = readFileSync(fileURLToPath(new URL('../styleguide/index.html', import.meta.url)), 'utf8');
  const m = html.match(/<html[^>]*data-theme="([^"]+)"/);
  assert.ok(m, '样张页 <html> 上没有 data-theme');
  assert.equal(m[1], 'deep-space', '样张页开局的主题和 MTM-276 定的 A 对不上');
});

/* ---------------- 对比度 ----------------
   顾检在 MTM-276 验收时量出来的真缺陷:次要文字和「中止任务」按钮上的白字
   都不到 WCAG AA 的 4.5。色值这种东西改一次很容易再漂回去,所以钉成测试。

   门槛只卡「文字压底色」这一类,四层底色 --pc-bg-0~3 加两个按钮底。
   已知还差一处不在门槛内:浅色主题 C 的 --pc-bg-sunken(输入框底)偏暗,
   placeholder 压上去只有 3.58。修它要把 --pc-bg-sunken 拆成「凹陷面」和
   「硬投影」两个 token(现在按钮投影、进度条槽、立绘地面影子都在用它),
   动静比这次该做的大,而且 C 是备选主题 —— 已记进发现池 MTM-270。 */

test('三套主题的文字压底色都过 WCAG AA 4.5', () => {
  const rows = audit(readThemes(TOKENS)).filter((r) => r.bg !== '--pc-bg-sunken');
  assert.ok(rows.length >= 39, `体检组合只有 ${rows.length} 组,像是没解析到主题`);
  const bad = rows.filter((r) => !r.pass)
    .map((r) => `${r.theme} ${r.fg}(${r.fgHex}) 压 ${r.bg}(${r.bgHex}) = ${r.ratio.toFixed(2)}`);
  assert.deepEqual(bad, [], '这些组合看不清 —— ' + bad.join(' / '));
});

test('「中止任务」是销毁性操作,白字必须压得住', () => {
  const themes = readThemes(TOKENS);
  for (const [name, v] of Object.entries(themes)) {
    assert.ok(v['--pc-danger-bg'], `${name} 缺 --pc-danger-bg`);
    const r = contrast('#ffffff', v['--pc-danger-bg']);
    assert.ok(r >= AA_TEXT, `${name} 的中止任务按钮白字只有 ${r.toFixed(2)},要 ${AA_TEXT}`);
  }
});

test('次要文字要比正文淡 —— 达标不能靠把它调得和正文一样深', () => {
  const themes = readThemes(TOKENS);
  for (const [name, v] of Object.entries(themes)) {
    for (const bg of ['--pc-bg-0', '--pc-bg-1', '--pc-bg-2', '--pc-bg-3']) {
      const dim = contrast(v['--pc-text-dim'], v[bg]);
      const body = contrast(v['--pc-text'], v[bg]);
      assert.ok(dim < body,
        `${name} 在 ${bg} 上:次要文字 ${dim.toFixed(2)} 不比正文 ${body.toFixed(2)} 淡,层级没了`);
    }
  }
});

test('按钮底色压在面板上要看得见(图形对比度 ≥ 3)', () => {
  const themes = readThemes(TOKENS);
  for (const [name, v] of Object.entries(themes)) {
    for (const t of ['--pc-danger-bg', '--pc-accent']) {
      const r = contrast(v[t], v['--pc-bg-1']);
      assert.ok(r >= 3, `${name} 的 ${t} 压在面板上只有 ${r.toFixed(2)},按钮边界看不出来`);
    }
  }
});
