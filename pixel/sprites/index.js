/**
 * 像素立绘对外入口 —— 用它的人只需要认识这一个文件。
 *
 * 没有构建步骤,是原生 ES 模块 + 一个自定义元素,
 * React / Vue / 原生 全都能直接用。周构那边最后选什么框架都不影响。
 *
 * 用法一(HTML,最省事):
 *   <script type="module" src="/pixel/sprites/index.js"></script>
 *   <pixel-avatar agent="gu" state="working" scale="4"></pixel-avatar>
 *
 * 用法二(JS):
 *   import { ROSTER, getSheet, applySprite } from '/pixel/sprites/index.js';
 *   applySprite(el, 'gu', 'working');
 *
 * agent 属性可以填名册 key(gu),也可以直接填 Multica 的 agent id ——
 * 后者更省事:聚合接口给什么就填什么,不用在业务代码里做映射。
 */
import { ROSTER, byKey, byAgentId } from './roster.js';
import { buildSheet, cellOffset, STATES, FRAMES, drawSprite, STATE_FROM_CONTRACT, toSpriteState } from './renderer.js';
import { G } from './body.js';

export { ROSTER, byKey, byAgentId, STATES, FRAMES, drawSprite, cellOffset, STATE_FROM_CONTRACT, toSpriteState };

let sheet = null;

/** 图集只烘一次(13 × 4 × 2 = 104 张,约 30ms),之后所有立绘共用这一张纹理 */
export function getSheet() {
  if (!sheet) sheet = buildSheet(ROSTER, {}, 1);
  return sheet;
}

/** key 或 agentId 都认 */
export function resolve(idOrKey) {
  return byKey[idOrKey] || byAgentId[idOrKey] || null;
}

/**
 * 把一个 DOM 元素变成某个角色某个状态的立绘。
 * @param {HTMLElement} el
 * @param {string} idOrKey 名册 key 或 Multica agent id
 * @param {string} state   working | idle | stuck | failed
 * @param {object} [opts]  { animate = true, frame = 0 }
 */
export function applySprite(el, idOrKey, state = 'idle', opts = {}) {
  const c = resolve(idOrKey);
  if (!c) { el.dataset.pcMissing = idOrKey; return false; }
  const st = toSpriteState(state);
  const sh = getSheet();
  const { animate = true, frame = 0 } = opts;

  el.classList.add('pc-sprite');
  el.style.setProperty('--pc-sheet-cols', sh.cols);
  el.style.setProperty('--pc-sheet-rows', sh.rows);
  el.style.backgroundImage = `url(${sh.url})`;

  // 尺寸完全交给 CSS(--pc-sprite-scale),这里只负责在图集里选对格子。
  // 必须就地现算,不能引用一个预先算好的尺寸变量 —— 见 tokens.css 里的说明。
  const at = (n) => `calc(var(--pc-sprite-grid) * var(--pc-sprite-scale) * ${-n}px)`;
  const colOf = (f) => STATES.indexOf(st) * FRAMES + f;

  el.style.backgroundPositionY = at(sh.index[c.key]);
  if (animate) {
    el.classList.add('pc-sprite--anim');
    el.style.setProperty('--pc-frame-a', at(colOf(0)));
    el.style.setProperty('--pc-frame-b', at(colOf(1)));
  } else {
    el.classList.remove('pc-sprite--anim');
    el.style.backgroundPositionX = at(colOf(frame));
  }
  el.style.setProperty('--pc-unit-c', c.unit);
  return true;
}

/** 单张离屏 canvas —— 需要独立一张图(导出、分享、贴到别处)时用 */
export function spriteCanvas(idOrKey, state = 'idle', scale = 4, frame = 0) {
  const c = resolve(idOrKey);
  if (!c) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = G * scale;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  drawSprite(c, state, frame).drawInto(img, 0, 0, scale);
  ctx.putImageData(img, 0, 0);
  return cv;
}

/* ---------------- <pixel-avatar> ---------------- */

// 在 Node 里 import 本文件不该炸(测试、SSR 都可能这么干),所以整段守起来
const HAS_DOM = typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined';

class PixelAvatar extends (HAS_DOM ? HTMLElement : class {}) {
  static observedAttributes = ['agent', 'state', 'scale', 'animate'];

  connectedCallback() { this.#render(); }
  attributeChangedCallback() { if (this.isConnected) this.#render(); }

  #render() {
    const agent = this.getAttribute('agent');
    const state = this.getAttribute('state') || 'idle';
    const scale = this.getAttribute('scale');
    const animate = this.getAttribute('animate') !== 'false';
    if (scale) this.style.setProperty('--pc-sprite-scale', scale);
    this.style.display = 'block';
    applySprite(this, agent, state, { animate });
    // 无障碍:立绘是纯背景图,读屏器需要一句人话
    const c = resolve(agent);
    const label = {
      working: '战斗中', fighting: '战斗中',
      idle: '待命', stuck: '卡住', stalled: '卡住',
      failed: '失败', defeated: '失败',
      waiting: '待接力',
      offline: '离线', unknown: '状态未知',
    }[state] || state;
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', c ? `${c.name}（${c.title}），${label}` : `未知角色 ${agent}`);
  }
}

if (HAS_DOM && !customElements.get('pixel-avatar')) {
  customElements.define('pixel-avatar', PixelAvatar);
}
