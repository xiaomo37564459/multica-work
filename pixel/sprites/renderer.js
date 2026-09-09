/**
 * 立绘渲染器 —— 把「名册记录 + 状态 + 帧」组装成一张 32×32 的像素图。
 *
 * 四个状态怎么做到不靠文字也能分清(这是本模块的设计核心):
 *   干活 working  身体前倾、道具高举、火花四溅、眯眼皱眉 —— 有动作
 *   空闲 idle     站姿放松、道具垂在身侧、圆眼平嘴、只有呼吸起伏 —— 没动作也没标记
 *   卡住 stuck    头歪一边、道具垂下、头顶「?」气泡 + 汗滴、眼睛缩成点 —— 有标记没进展
 *   失败 failed   整个人塌下去、✕ 眼、道具倒在脚边、全身压暗偏红 —— 姿势整个变了
 * 一句话:动作 → 无标记 → 问号 → 倒地,四级递进,离远了也分得开。
 */
import { Grid } from './grid.js';
import { INK, SHOE, despair, drained, tint } from './palette.js';
import { BOX, G, drawHead, drawNeck, drawTorso, drawArms, drawLegs, FACE } from './body.js';
import { HEADS, OUTFITS, PROPS } from './parts.js';
import { unitColors } from './roster.js';

export const STATES = ['working', 'idle', 'stuck', 'failed'];
export const FRAMES = 2;

/**
 * 数据契约(MTM-275 的 BattleState)→ 立绘状态 的映射。
 *
 * 契约有 6 个状态,立绘只画了 4 套姿势 —— offline 和 unknown 借用空闲的姿势,
 * 靠卡片边框和状态灯区分。这样做的理由:这两个状态说的是「拿不到消息」,
 * 不是「角色在做什么」,给它们编一个动作反而是在骗人。
 *
 * 传 4 个立绘状态名进来也认,所以本地写死假数据时不用先查表。
 */
export const STATE_FROM_CONTRACT = {
  fighting: 'working',
  stalled: 'stuck',
  defeated: 'failed',
  // waiting(待接力)= 策衡定的第七种契约状态:活派下去了,本人在等接力回来。
  // 一期不画第五套姿势 —— 用空闲立绘,区分靠 .pc-flag--waiting 角标 + waiting 状态灯。
  waiting: 'idle',
  idle: 'idle',
  offline: 'idle',
  unknown: 'idle',
};

/** 归一成立绘用的四个状态名;不认识的一律当空闲,绝不白屏 */
export function toSpriteState(state) {
  if (STATES.includes(state)) return state;
  return STATE_FROM_CONTRACT[state] || 'idle';
}


/** 姿势表:每个状态两帧。h=头 t=躯干 al/ar=左右手臂 dx=水平偏移 */
const POSE = {
  idle: [
    { h: 0, t: 0, al: 0, ar: 0 },
    { h: 1, t: 1, al: 1, ar: 1 },          // 呼吸:整个上半身沉 1 像素
  ],
  working: [
    { h: -1, t: 0, al: -1, ar: -7, hdx: 1 },  // 道具举到最高,身体前倾
    { h: 0, t: 0, al: 1, ar: 0, hdx: 1 },     // 砸下来 —— 两帧循环就是「在敲」
  ],
  stuck: [
    { h: 0, t: 0, al: 1, ar: 2, hdx: 1 },  // 头歪、手垂
    { h: 1, t: 0, al: 1, ar: 2, hdx: 1 },
  ],
  // 上半身整体等量下沉,腿不动 —— 「瘫坐」是这么来的。
  // 头不能比躯干沉得多,否则脑袋会埋进胸口,连是谁都看不出来了。
  failed: [
    { h: 2, t: 2, al: 2, ar: 2, dropProp: true },
    { h: 2, t: 2, al: 2, ar: 2, dropProp: true },
  ],
};

const EYE_ROW = 10;   // 眼睛所在行(头部内的绝对 y)

/* ---------------- 状态覆盖物 ---------------- */

/**
 * 工作:道具落点炸出的火花。
 * 这是「干活」和「空闲」拉开距离的主力 —— 光靠抬手臂,静止截图上分不出来。
 * 两帧的爆点位置和大小都不同,连起来看就是在一下一下地砸。
 */
function overlayWorking(g, frame, accent) {
  const [cx, cy] = frame === 0 ? [26, 6] : [25, 13];
  const star = frame === 0
    ? [[0, -3], [0, -2], [0, 2], [0, 3], [-3, 0], [-2, 0], [2, 0], [3, 0], [-2, -2], [2, 2], [2, -2], [-2, 2]]
    : [[0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, 1]];
  star.forEach(([dx, dy]) => g.set(cx + dx, cy + dy, accent));
  g.rect(cx - 1, cy - 1, 3, 3, '#ffffff');
  // 另外两粒溅开的火星
  const bits = frame === 0 ? [[30, 11], [21, 2]] : [[30, 17], [20, 8]];
  bits.forEach(([x, y]) => g.set(x, y, accent));
}

/** 卡住:头顶「?」气泡 + 汗滴。这是四态里最强的单一信号 */
function overlayStuck(g, frame, stuckColor) {
  const bx = 22, by = frame === 0 ? 0 : 1;
  g.rect(bx, by, 8, 8, '#f3ecd8');
  g.clear(bx, by); g.clear(bx + 7, by);
  g.clear(bx, by + 7); g.clear(bx + 7, by + 7);
  g.set(bx + 1, by + 8, '#f3ecd8'); g.set(bx, by + 9, '#f3ecd8');   // 气泡小尾巴
  const q = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2], [2, 2], [1, 3], [1, 5]];
  q.forEach(([dx, dy]) => g.set(bx + 2 + dx, by + 1 + dy, stuckColor));
  // 汗滴
  g.set(8, 6 + frame, '#8fd8ea'); g.set(8, 7 + frame, '#8fd8ea'); g.set(7, 7 + frame, '#8fd8ea');
}

/** 失败:头顶碎裂的三道口子 */
function overlayFailed(g, failColor) {
  const shards = [[13, 1], [16, 0], [19, 1]];
  shards.forEach(([x, y]) => {
    g.set(x, y, failColor); g.set(x, y + 1, failColor); g.set(x + 1, y + 2, failColor);
  });
}

/* ---------------- 单张立绘 ---------------- */

/**
 * 画一张立绘。
 * @param {object} c     ROSTER 里的一条记录
 * @param {string} state working | idle | stuck | failed
 * @param {number} frame 0 | 1
 * @param {object} stateColors 四态语义色(从 tokens.css 读出来传进来,保证卡片和立绘同色)
 * @returns {Grid}
 */
export function drawSprite(c, state, frame = 0, stateColors = {}) {
  const p = POSE[state][frame];
  const col = unitColors(c);
  const g = new Grid(G);
  const torsoY = BOX.torsoY0 + p.t;
  const outfit = OUTFITS[c.outfit];

  // 1. 摔在地上的道具最先画,后面的腿会盖住一角 —— 看着才像「掉在脚边」
  if (p.dropProp) dropProp(g, c, col);

  // 2. 服装后层(披风、裙摆)—— 在手臂之前
  outfit.back(g, col.cloth, torsoY, col.accent);

  // 3. 腿脚(失败态腿不动,只有上半身塌下去,才有「瘫坐」的感觉)
  drawLegs(g, col.pants, SHOE);

  // 4. 手臂 + 手
  drawArms(g, col.cloth, col.skin, p.al, p.ar);

  // 5. 躯干 + 服装前层
  drawTorso(g, col.cloth, torsoY);
  outfit.front(g, col.cloth, torsoY, col.accent);

  // 6. 脖子 —— 按头和躯干的实际位置算,所以任何姿势都不会断开
  drawNeck(g, col.skin, BOX.headY1 + p.h, torsoY);

  // 7. 头:单独画在一层再整体位移,头发/眼镜自然跟着头走
  const head = new Grid(G);
  drawHead(head, col.skin);
  FACE[state](head, EYE_ROW);
  HEADS[c.head](head, col.hair, col.accent);
  g.blit(head.shifted(p.hdx || 0, p.h));

  // 8. 道具(握在右手里;摔在地上的那份已经在第 1 步画过了)
  if (!p.dropProp) PROPS[c.prop](g, BOX.armRX + 1, BOX.armY0 + 7 + p.ar, col.prop);

  // 9. 四态调色 —— 在描边之前做,描边色永远保持纯净,13 个人的线条才一致
  if (state === 'failed') g.mapColors(despair);
  else if (state === 'stuck') g.mapColors(drained);

  // 10. 状态覆盖物(不参与调色,必须够亮才抓得住眼睛)
  if (state === 'working') overlayWorking(g, frame, tint(c.accent, 1));
  else if (state === 'stuck') overlayStuck(g, frame, stateColors.stuck || '#8a5a00');
  else if (state === 'failed') overlayFailed(g, stateColors.failed || '#ff4f62');

  // 11. 统一描边 —— 全员共用这一次调用,线条粗细绝不会因人而异
  g.outline(INK);
  return g;
}

/**
 * 失败态:把道具整体旋转 90° 摔在地上。
 * 好处是不用给 13 件道具各画一份「倒下」的版本 —— 加新道具时自动就有失败态。
 */
function dropProp(g, c, col) {
  const tmp = new Grid(G);
  PROPS[c.prop](tmp, 16, 20, col.prop);
  const b = tmp.bbox();
  if (!b) return;
  const rotW = b.y1 - b.y0 + 1;
  const landX = Math.max(0, Math.min(G - rotW, 19));   // 尽量靠右,但不许出画布
  const landY = G - 2;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const v = tmp.get(x, y);
      if (v) g.set(landX + (b.y1 - y), landY - (x - b.x0), v);
    }
  }
}

/* ---------------- 精灵图集 ---------------- */

/**
 * 把全员 × 四态 × 两帧烘成一张图集。
 * 一次性生成一张纹理,卡片只切 background-position —— 13 个角色同屏也只有 1 次解码。
 */
export function buildSheet(roster, stateColors = {}, scale = 1) {
  const cols = STATES.length * FRAMES;
  const rows = roster.length;
  const cv = document.createElement('canvas');
  cv.width = cols * G * scale;
  cv.height = rows * G * scale;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);

  roster.forEach((c, r) => {
    STATES.forEach((st, si) => {
      for (let f = 0; f < FRAMES; f++) {
        const col = si * FRAMES + f;
        drawSprite(c, st, f, stateColors)
          .drawInto(img, col * G * scale, r * G * scale, scale);
      }
    });
  });
  ctx.putImageData(img, 0, 0);

  return {
    url: cv.toDataURL('image/png'),
    canvas: cv,
    cell: G * scale,
    cols, rows, scale,
    index: Object.fromEntries(roster.map((c, i) => [c.key, i])),
  };
}

/** 单个精灵在图集里的位置(给 background-position 用) */
export function cellOffset(sheet, key, state, frame = 0) {
  const row = sheet.index[key];
  const col = STATES.indexOf(state) * FRAMES + frame;
  return { x: -col * sheet.cell, y: -row * sheet.cell };
}
