/**
 * 共用身体 —— 13 个角色的骨架完全出自这一个函数。
 * 差异只允许来自:身份色 / 发型头饰 / 服装领口 / 手里的道具。
 * 这是「一眼看得出是同一套世界观」的结构保证。
 *
 * 32×32 网格坐标约定(改这里等于改全员,慎动):
 *   头 y4..15 (x10..21)   脖 y16   躯干 y17..24 (x11..20)
 *   手臂 y18..24 (左 x8..10 / 右 x21..23)   手 y25..26
 *   腿 y25..28   脚 y29..30   y31 留给失败态下沉
 *
 * 硬规矩:任何部件都不许画在第 0 行 —— 那一行留给自动描边。
 * 占了第 0 行,头顶的描边就补不上去,剪影会被切平。已由测试守着。
 */
import { Grid } from './grid.js';
import { INK, INK_SOFT, ramp, tint, shade } from './palette.js';

export const G = 32;

export const BOX = {
  headX0: 10, headX1: 21, headY0: 4, headY1: 15,
  neckY: 16,
  torsoX0: 11, torsoX1: 20, torsoY0: 17, torsoY1: 24,
  armLX: 8, armRX: 21, armY0: 18, armY1: 24, handY: 25,
  legY0: 25, legY1: 28, footY: 29,
};

/** 头部轮廓:每行的 x 区间。全员共用,所以脸型永远一致 */
const HEAD_ROWS = [
  [12, 19], [11, 20], [10, 21], [10, 21], [10, 21], [10, 21],
  [10, 21], [10, 21], [10, 21], [11, 20], [12, 19], [13, 18],
];

export function drawHead(g, skin) {
  g.rows(BOX.headY0, HEAD_ROWS, skin.base);
  // 额头受光:统一顶光,所有角色一致
  g.hline(12, 4, 8, skin.light);
  g.hline(11, 5, 10, skin.light);
  // 下颌暗部
  g.hline(12, 14, 8, skin.mid);
  g.hline(13, 15, 6, skin.mid);
  // 耳朵
  g.rect(9, 10, 1, 2, skin.mid);
  g.rect(22, 10, 1, 2, skin.mid);
}

/** 脖子:按头和躯干的实际位置算,所以任何姿势偏移都不会断开 */
export function drawNeck(g, skin, headBottom, torsoTop) {
  for (let y = headBottom + 1; y < torsoTop; y++) g.hline(14, y, 4, skin.mid);
  g.hline(14, torsoTop - 1, 4, shade(skin.base, 1));
}

export function drawTorso(g, cloth, y0) {
  g.hline(11, y0, 10, cloth.base);
  g.rect(11, y0 + 1, 10, 6, cloth.base);
  g.hline(12, y0 + 7, 8, cloth.mid);
  // 统一顶光:肩线提亮一行
  g.hline(12, y0, 8, cloth.light);
  // 身体左右两侧收暗,做出圆柱感
  g.vline(11, y0 + 1, 6, cloth.mid);
  g.vline(20, y0 + 1, 6, cloth.mid);
}

export function drawArms(g, cloth, skin, lDy, rDy) {
  // 手臂比躯干暗一档 —— 靠明度分离,不靠描边,避免 32px 下线条糊成一坨
  g.rect(BOX.armLX, BOX.armY0 + lDy, 3, 7, cloth.mid);
  g.rect(BOX.armRX, BOX.armY0 + rDy, 3, 7, cloth.mid);
  g.vline(BOX.armLX, BOX.armY0 + lDy, 7, cloth.dark);
  g.vline(BOX.armRX + 2, BOX.armY0 + rDy, 7, cloth.dark);
  // 手
  g.rect(BOX.armLX, BOX.armY0 + 7 + lDy, 3, 2, skin.base);
  g.rect(BOX.armRX, BOX.armY0 + 7 + rDy, 3, 2, skin.base);
}

export function drawLegs(g, pants, shoe) {
  g.rect(12, BOX.legY0, 3, 4, pants.base);
  g.rect(17, BOX.legY0, 3, 4, pants.base);
  g.vline(12, BOX.legY0, 4, pants.dark);
  g.vline(17, BOX.legY0, 4, pants.dark);
  // 鞋
  g.rect(11, BOX.footY, 4, 2, shoe);
  g.rect(17, BOX.footY, 4, 2, shoe);
  g.hline(11, BOX.footY, 4, tint(shoe, 1));
  g.hline(17, BOX.footY, 4, tint(shoe, 1));
}

/* ---------------- 表情:四态各一套,不写字也能认出来 ---------------- */

export const FACE = {
  /** 空闲:正常圆眼 + 平嘴 */
  idle(g, y) {
    g.rect(12, y, 2, 2, INK); g.rect(18, y, 2, 2, INK);
    g.set(12, y, '#ffffff'); g.set(18, y, '#ffffff');
    g.hline(15, y + 3, 2, INK_SOFT);
  },
  /** 工作:眯眼专注(压成一行)+ 小张嘴,眉毛压低 */
  working(g, y) {
    g.hline(11, y - 2, 3, INK); g.hline(19, y - 2, 3, INK); // 压低的眉
    g.hline(12, y, 2, INK); g.hline(18, y, 2, INK);
    g.hline(12, y + 1, 2, INK_SOFT); g.hline(18, y + 1, 2, INK_SOFT);
    g.rect(15, y + 3, 2, 2, INK);
  },
  /** 卡住:眼睛缩成点 + 波浪嘴,眉毛挑起 */
  stuck(g, y) {
    g.set(11, y - 2, INK); g.set(12, y - 3, INK); g.set(13, y - 3, INK);
    g.set(20, y - 2, INK); g.set(19, y - 3, INK); g.set(18, y - 3, INK);
    g.set(13, y + 1, INK); g.set(18, y + 1, INK);
    g.set(14, y + 3, INK_SOFT); g.set(15, y + 4, INK_SOFT);
    g.set(16, y + 3, INK_SOFT); g.set(17, y + 4, INK_SOFT);
  },
  /** 失败:✕ 眼 + 下垂嘴 —— 全网通用的「倒下」符号 */
  failed(g, y) {
    for (const ox of [11, 17]) {
      g.set(ox, y, INK); g.set(ox + 2, y, INK);
      g.set(ox + 1, y + 1, INK);
      g.set(ox, y + 2, INK); g.set(ox + 2, y + 2, INK);
    }
    g.hline(14, y + 4, 4, INK_SOFT);
    g.set(13, y + 3, INK_SOFT); g.set(18, y + 3, INK_SOFT);
  },
};
