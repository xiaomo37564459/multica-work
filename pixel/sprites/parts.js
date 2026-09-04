/**
 * 部件库 —— 角色之间「认得出谁是谁」的全部差异都在这里。
 *
 * 三类部件,一个角色各挑一个:
 *   HEADS   头发/头饰。32px 下最强的辨识信号是剪影,所以每个人的头顶都不一样。
 *   OUTFITS 服装领口。分 back(手臂之前画,会被手臂盖住)和 front(手臂之后画)两层。
 *   PROPS   手里的道具。表达职业 —— 「他是干什么的」全靠它。
 */
import { INK_SOFT, MAT, tint, shade } from './palette.js';

const W = '#ffffff';

/* ==================== 头发 / 头饰 ==================== */

export const HEADS = {
  /** 沈执:后掠短发 + 尖锐额角,指挥官的硬朗剪影 */
  commander(g, c) {
    g.rows(2, [[12, 19], [11, 20], [10, 21], [10, 21]], c);
    g.rows(6, [[10, 12], [10, 11], [10, 11]], c);
    g.rows(6, [[19, 21], [20, 21], [20, 21]], c);
    g.hline(12, 2, 8, tint(c, 1));
    g.set(21, 3, c); g.set(22, 4, c);
  },
  /** 策衡:中分短发 + 耳后别一支笔 */
  parted(g, c) {
    g.rows(2, [[12, 19], [11, 20], [10, 21]], c);
    g.rows(5, [[10, 14], [10, 12], [10, 11]], c);
    g.rows(5, [[17, 21], [19, 21], [20, 21]], c);
    g.hline(12, 2, 4, tint(c, 1));
    g.vline(22, 8, 3, MAT.gold); g.set(22, 7, '#e8646e');
  },
  /** 林澄:齐刘海波波头 + 圆框眼镜,长发到下颌 */
  bob(g, c) {
    g.rows(2, [[12, 19], [11, 20], [10, 21], [10, 21], [10, 21]], c);
    g.vline(9, 6, 8, c); g.vline(22, 6, 8, c);
    g.vline(10, 12, 2, c); g.vline(21, 12, 2, c);
    g.hline(12, 2, 6, tint(c, 1));
    g.rect(11, 9, 4, 4, MAT.steel); g.rect(17, 9, 4, 4, MAT.steel);
    g.rect(12, 10, 2, 2, null); g.rect(18, 10, 2, 2, null);
    g.hline(15, 10, 2, MAT.steel);
  },
  /** 周构:全后梳 + 方框眼镜,一丝不苟 */
  slick(g, c) {
    g.rows(3, [[11, 20], [10, 21], [10, 21]], c);
    g.rows(6, [[10, 11], [10, 11]], c);
    g.rows(6, [[20, 21], [20, 21]], c);
    g.hline(12, 3, 3, tint(c, 1)); g.hline(16, 3, 3, tint(c, 1));
    g.rect(11, 9, 4, 4, MAT.dark); g.rect(17, 9, 4, 4, MAT.dark);
    g.rect(12, 10, 2, 2, null); g.rect(18, 10, 2, 2, null);
    g.hline(15, 10, 2, MAT.dark);
  },
  /** 韩程:反戴棒球帽 + 头戴耳机,长期在线的后端 */
  cap(g, c, accent) {
    g.rows(4, [[10, 21]], c);
    g.rows(1, [[13, 18], [11, 20], [10, 21]], accent);
    g.hline(10, 4, 12, shade(accent, 1));
    g.rect(14, 4, 4, 1, MAT.steel_hi);
    g.hline(13, 1, 4, tint(accent, 1));
    // 耳机头带压在帽子上。第 0 行必须留空 —— 那一行是留给描边的
    g.hline(12, 1, 8, MAT.dark);
    g.set(11, 1, MAT.dark); g.set(10, 2, MAT.dark);
    g.set(20, 1, MAT.dark); g.set(21, 2, MAT.dark);
    g.rect(8, 8, 2, 4, MAT.dark); g.rect(22, 8, 2, 4, MAT.dark);
    g.vline(9, 9, 2, MAT.steel); g.vline(22, 9, 2, MAT.steel);
    g.vline(8, 3, 5, MAT.dark); g.vline(23, 3, 5, MAT.dark);
  },
  /** 许界:蓬松卷发,轮廓是波浪不是平面 */
  curly(g, c) {
    g.rows(3, [[11, 20], [10, 21], [10, 21], [10, 21]], c);
    for (const x of [11, 14, 17, 20]) { g.set(x, 2, c); g.set(x + 1, 1, c); g.set(x + 1, 2, c); }
    g.rows(7, [[9, 10]], c); g.rows(7, [[21, 22]], c);
    g.set(9, 8, c); g.set(22, 8, c);
    g.set(12, 2, tint(c, 1)); g.set(15, 2, tint(c, 1)); g.set(18, 2, tint(c, 1));
  },
  /** 苏绘:贝雷帽(歪戴)+ 长发过肩,设计师的招牌 */
  beret(g, c, accent) {
    g.rows(4, [[10, 21], [10, 21]], c);
    g.vline(9, 6, 12, c); g.vline(22, 6, 12, c);
    g.vline(8, 9, 8, c); g.vline(23, 9, 8, c);
    g.rows(2, [[12, 20], [10, 22], [10, 22]], accent);
    g.hline(11, 2, 5, tint(accent, 1));
    g.set(11, 1, accent); g.set(12, 1, accent);
    g.hline(10, 5, 13, shade(accent, 2));
  },
  /** 唐端:锯齿寸头,轮廓最短最利落 */
  crop(g, c) {
    g.rows(3, [[11, 20], [10, 21], [10, 21]], c);
    for (let x = 10; x <= 21; x += 2) g.set(x, 2, c);
    g.rows(6, [[10, 10]], c); g.rows(6, [[21, 21]], c);
    g.hline(13, 3, 5, tint(c, 1));
  },
  /** 顾检:护目镜推在额头 + 后扎小辫 */
  goggles(g, c) {
    g.rows(3, [[11, 20], [10, 21], [10, 21]], c);
    g.hline(9, 6, 14, MAT.dark);
    g.rect(11, 5, 4, 3, MAT.dark); g.rect(17, 5, 4, 3, MAT.dark);
    g.rect(12, 6, 2, 1, MAT.glass); g.rect(18, 6, 2, 1, MAT.glass);
    g.rect(22, 8, 2, 4, c); g.set(24, 9, c); g.set(24, 10, c);
  },
  /** 梁运:工程安全帽 + 宽帽檐,全场最好认的剪影 */
  hardhat(g, c, accent) {
    g.rows(4, [[10, 21]], c);
    g.rows(1, [[13, 18], [11, 20], [10, 21]], accent);
    g.hline(8, 4, 16, accent);
    g.hline(8, 5, 16, shade(accent, 2));
    g.vline(15, 1, 3, tint(accent, 1)); g.vline(16, 1, 3, tint(accent, 1));
  },
  /** 秦划:顶髻 + 利落鬓角 */
  bun(g, c) {
    g.rect(14, 1, 4, 3, c); g.set(13, 2, c); g.set(18, 2, c);
    g.rows(3, [[11, 20], [10, 21], [10, 21]], c);
    g.rows(6, [[10, 11]], c); g.rows(6, [[20, 21]], c);
    g.hline(15, 1, 2, tint(c, 1));
  },
  /** Mika:独角 + 长卷发 + 蝴蝶结,唯一有角的角色 */
  horn(g, c, accent) {
    g.set(16, 1, MAT.gold); g.rect(15, 2, 3, 1, MAT.gold); g.rect(15, 3, 3, 1, MAT.gold_dk);
    g.set(16, 2, tint(MAT.gold, 1));
    g.rows(3, [[11, 20], [10, 21], [10, 21]], c);
    g.vline(9, 6, 11, c); g.vline(22, 6, 11, c);
    g.vline(8, 10, 6, c); g.vline(23, 10, 6, c);
    g.set(8, 16, c); g.set(23, 16, c);
    g.rect(19, 4, 3, 2, accent); g.set(21, 3, accent); g.set(19, 6, accent);
    g.hline(12, 3, 5, tint(c, 1));
  },
  /** Multica Helper:机体不是人 —— 光面头 + 横向面罩 + 天线 */
  visor(g) {
    g.vline(16, 1, 3, MAT.steel); g.rect(15, 1, 3, 1, MAT.steel_hi);
    g.rows(3, [[11, 20], [10, 21]], MAT.steel_hi);
    g.rect(10, 8, 12, 5, MAT.dark);
    g.hline(11, 9, 10, '#1b2440');
    g.hline(12, 3, 6, W);
  },
};

/* ==================== 服装 ==================== */

const none = () => {};

export const OUTFITS = {
  /** 沈执:披风 + 立领 + 肩章 */
  cape: {
    back(g, cl, y0) {
      g.rect(8, y0, 16, 10, cl.dark);
      g.rect(8, y0 + 10, 16, 1, shade(cl.dark, 1));
      g.vline(8, y0, 11, shade(cl.dark, 2)); g.vline(23, y0, 11, shade(cl.dark, 2));
    },
    front(g, cl, y0) {
      g.rect(11, y0 - 1, 2, 3, cl.light); g.rect(19, y0 - 1, 2, 3, cl.light);
      g.rect(10, y0, 3, 2, MAT.gold); g.rect(19, y0, 3, 2, MAT.gold);
      g.vline(15, y0 + 2, 6, MAT.gold_dk); g.vline(16, y0 + 2, 6, MAT.gold);
    },
  },
  /** 策衡 / 秦划:马甲 + 领带 */
  vest: {
    back: none,
    front(g, cl, y0, accent) {
      g.rect(14, y0, 4, 3, W);
      g.set(13, y0 + 1, cl.dark); g.set(14, y0 + 2, cl.dark);
      g.set(18, y0 + 1, cl.dark); g.set(17, y0 + 2, cl.dark);
      g.rect(15, y0 + 2, 2, 1, accent);
      g.rect(15, y0 + 3, 2, 4, accent);
      g.set(15, y0 + 7, shade(accent, 1)); g.set(16, y0 + 7, shade(accent, 1));
    },
  },
  /** 林澄 / 周构:长外套翻领 + 两颗扣 */
  coat: {
    back: none,
    front(g, cl, y0) {
      g.rect(14, y0, 4, 2, W);
      g.rect(12, y0, 2, 4, cl.light); g.rect(18, y0, 2, 4, cl.light);
      g.vline(15, y0 + 2, 6, cl.dark); g.vline(16, y0 + 2, 6, shade(cl.base, 1));
      g.set(13, y0 + 4, MAT.steel_hi); g.set(13, y0 + 6, MAT.steel_hi);
    },
  },
  /** 韩程 / 唐端:连帽衫 + 抽绳 + 口袋 */
  hoodie: {
    back(g, cl, y0) { g.rect(10, y0 - 1, 12, 3, cl.dark); },
    front(g, cl, y0) {
      g.rect(12, y0, 8, 2, shade(cl.base, 2));
      g.set(14, y0 + 2, W); g.set(17, y0 + 2, W);
      g.vline(14, y0 + 3, 2, MAT.paper); g.vline(17, y0 + 3, 2, MAT.paper);
      g.hline(12, y0 + 5, 8, cl.dark);
      g.hline(12, y0 + 6, 8, shade(cl.base, 1));
    },
  },
  /** 许界:彩虹围巾 —— 全场唯一的多色部件 */
  scarf: {
    back: none,
    front(g, cl, y0) {
      const bands = ['#e35b5b', '#e8a13c', '#e3d24a', '#5fc46b', '#4a9be3', '#8b5cf6'];
      g.hline(10, y0 - 1, 12, bands[0]);
      g.hline(10, y0, 12, bands[2]);
      g.hline(10, y0 + 1, 12, bands[4]);
      g.rect(20, y0 + 2, 3, 5, bands[1]);
      g.hline(20, y0 + 4, 3, bands[3]);
    },
  },
  /** 苏绘:工作围裙 + 胸前口袋(插着三支颜料) */
  apron: {
    back: none,
    front(g, cl, y0) {
      g.rect(12, y0 + 2, 8, 6, cl.light);
      g.vline(13, y0, 2, cl.light); g.vline(18, y0, 2, cl.light);
      g.hline(13, y0 + 4, 6, shade(cl.light, 1));
      g.set(14, y0 + 5, '#e35fa8'); g.set(16, y0 + 5, '#38b8d8'); g.set(17, y0 + 5, MAT.gold);
      g.rect(14, y0, 4, 2, W);
    },
  },
  /** 顾检:胸甲 + 肩甲,唯一穿硬甲的人 */
  armor: {
    back: none,
    front(g, cl, y0) {
      g.rect(12, y0 + 1, 8, 5, MAT.steel);
      g.hline(12, y0 + 1, 8, MAT.steel_hi);
      g.hline(12, y0 + 3, 8, cl.dark);
      g.rect(10, y0, 3, 2, MAT.steel); g.rect(19, y0, 3, 2, MAT.steel);
      g.hline(10, y0, 3, MAT.steel_hi); g.hline(19, y0, 3, MAT.steel_hi);
      g.rect(14, y0, 4, 2, cl.light);
    },
  },
  /** 梁运:反光工装背心 */
  hivis: {
    back: none,
    front(g, cl, y0) {
      g.rect(11, y0, 10, 8, '#e8762c');
      g.hline(11, y0 + 2, 10, MAT.steel_hi);
      g.hline(11, y0 + 5, 10, MAT.steel_hi);
      g.rect(14, y0, 4, 8, shade('#e8762c', 2));
      g.rect(15, y0, 2, 3, W);
    },
  },
  /** Mika:外扩裙摆,轮廓下宽 */
  dress: {
    back(g, cl, y0) {
      g.rows(y0 + 6, [[11, 20], [10, 21], [9, 22], [9, 22]], cl.base);
      g.hline(9, y0 + 9, 14, cl.mid);
    },
    front(g, cl, y0) {
      g.rect(14, y0, 4, 2, W);
      g.hline(11, y0 + 5, 10, MAT.gold);
      g.set(15, y0 + 5, MAT.gold_dk); g.set(16, y0 + 5, tint(MAT.gold, 1));
    },
  },
  /** Helper:机体外壳 + 中央指示灯 */
  shell: {
    back: none,
    front(g, cl, y0) {
      g.rect(12, y0, 8, 7, MAT.steel_hi);
      g.hline(12, y0 + 3, 8, MAT.steel);
      g.rect(15, y0 + 4, 2, 2, cl.base);
      g.vline(11, y0, 8, MAT.steel); g.vline(20, y0, 8, MAT.steel);
    },
  },
};

/* ==================== 道具 ==================== */
/* 全部以「右手中心」(hx, hy) 为锚点向上生长 —— 姿势一变,道具跟着走 */

export const PROPS = {
  /** 沈执:指挥旗 */
  banner(g, hx, hy, cl) {
    g.vline(hx, hy - 14, 17, MAT.wood);
    g.vline(hx, hy - 14, 3, MAT.gold);
    g.rect(hx + 1, hy - 13, 5, 6, cl.base);
    g.hline(hx + 1, hy - 13, 5, cl.light);
    g.clear(hx + 5, hy - 10); g.clear(hx + 5, hy - 9);
    g.rect(hx + 2, hy - 11, 2, 2, MAT.gold);
  },
  /** 策衡:原型板 */
  clipboard(g, hx, hy, cl) {
    g.rect(hx - 1, hy - 9, 6, 10, MAT.paper);
    g.rect(hx, hy - 10, 4, 1, MAT.steel);
    g.hline(hx, hy - 7, 4, cl.base);
    g.hline(hx, hy - 5, 3, INK_SOFT);
    g.hline(hx, hy - 3, 4, INK_SOFT);
    g.hline(hx, hy - 1, 2, INK_SOFT);
  },
  /** 林澄:放大镜 */
  magnifier(g, hx, hy) {
    g.rect(hx, hy - 9, 5, 5, MAT.steel);
    g.rect(hx + 1, hy - 8, 3, 3, MAT.glass);
    g.set(hx + 1, hy - 8, W);
    g.set(hx, hy - 4, MAT.wood);
    g.set(hx - 1, hy - 3, MAT.wood); g.set(hx - 1, hy - 2, MAT.wood);
  },
  /** 周构:三角尺 */
  setsquare(g, hx, hy) {
    for (let i = 0; i < 8; i++) { g.set(hx, hy - 9 + i, MAT.steel_hi); g.set(hx + i, hy - 2, MAT.steel_hi); }
    for (let i = 0; i < 8; i++) g.set(hx + i, hy - 9 + i, MAT.steel);
    g.set(hx + 1, hy - 3, MAT.steel_hi); g.set(hx + 2, hy - 4, MAT.steel_hi);
  },
  /** 韩程:数据库三层柱 */
  dbstack(g, hx, hy, cl) {
    for (let k = 0; k < 3; k++) {
      const y = hy - 9 + k * 3;
      g.rect(hx - 1, y, 6, 3, cl.base);
      g.hline(hx - 1, y, 6, cl.light);
      g.hline(hx - 1, y + 2, 6, cl.dark);
      g.set(hx, y + 1, MAT.steel_hi);
    }
  },
  /** 许界:浏览器窗口 */
  browser(g, hx, hy, cl) {
    g.rect(hx - 2, hy - 10, 8, 9, MAT.paper);
    g.hline(hx - 2, hy - 10, 8, cl.base);
    g.hline(hx - 2, hy - 9, 8, cl.dark);
    g.set(hx - 1, hy - 10, W); g.set(hx + 1, hy - 10, W); g.set(hx + 3, hy - 10, W);
    g.hline(hx - 1, hy - 7, 6, INK_SOFT);
    g.rect(hx - 1, hy - 5, 3, 3, cl.mid);
    g.hline(hx + 3, hy - 5, 3, INK_SOFT); g.hline(hx + 3, hy - 3, 3, INK_SOFT);
  },
  /** 苏绘:画笔 + 飞溅的颜料 */
  brush(g, hx, hy, cl) {
    for (let i = 0; i < 7; i++) g.set(hx + i - 1, hy - 2 - i, MAT.wood);
    g.set(hx + 5, hy - 8, MAT.steel_hi); g.set(hx + 4, hy - 7, MAT.steel_hi);
    g.set(hx + 6, hy - 9, cl.base); g.set(hx + 5, hy - 9, cl.light);
    g.set(hx + 6, hy - 10, cl.base);
    g.set(hx + 3, hy - 12, cl.light); g.set(hx + 5, hy - 13, MAT.glass);
  },
  /** 唐端:手机 */
  phone(g, hx, hy, cl) {
    g.rect(hx, hy - 9, 4, 10, cl.base);
    g.hline(hx, hy - 9, 4, cl.light);
    g.rect(hx + 1, hy - 8, 2, 7, MAT.dark);
    g.hline(hx + 1, hy - 8, 2, MAT.glass);
    g.set(hx + 1, hy - 1, cl.light);
  },
  /** 顾检:盾牌 + 勾 */
  shield(g, hx, hy, cl) {
    g.rows(hy - 10, [[hx - 1, hx + 4], [hx - 1, hx + 4], [hx - 1, hx + 4],
                     [hx - 1, hx + 4], [hx, hx + 3], [hx + 1, hx + 2]], cl.base);
    g.hline(hx - 1, hy - 10, 6, MAT.steel_hi);
    g.set(hx, hy - 7, W); g.set(hx + 1, hy - 6, W);
    g.set(hx + 2, hy - 7, W); g.set(hx + 3, hy - 8, W);
    g.vline(hx + 1, hy - 4, 4, MAT.wood);
  },
  /** 梁运:扳手 */
  wrench(g, hx, hy) {
    g.vline(hx + 1, hy - 7, 9, MAT.steel);
    g.vline(hx + 2, hy - 7, 9, MAT.steel_hi);
    g.rect(hx, hy - 10, 2, 3, MAT.steel);
    g.rect(hx + 3, hy - 10, 2, 3, MAT.steel);
    g.hline(hx, hy - 8, 5, MAT.steel_hi);
    g.clear(hx + 2, hy - 10); g.clear(hx + 2, hy - 9);
  },
  /** 秦划:甘特图板 */
  gantt(g, hx, hy, cl) {
    g.rect(hx - 2, hy - 9, 8, 9, MAT.paper);
    g.hline(hx - 2, hy - 9, 8, cl.dark);
    g.hline(hx - 1, hy - 7, 5, cl.base);
    g.hline(hx, hy - 5, 5, MAT.gold);
    g.hline(hx + 1, hy - 3, 4, cl.mid);
  },
  /** Mika:星杖 */
  wand(g, hx, hy, cl) {
    g.vline(hx + 1, hy - 6, 8, MAT.wood);
    g.set(hx + 1, hy - 10, MAT.gold); g.set(hx + 1, hy - 8, MAT.gold);
    g.hline(hx, hy - 9, 3, MAT.gold);
    g.set(hx + 1, hy - 9, W);
    g.set(hx + 3, hy - 12, cl.base); g.set(hx - 1, hy - 12, cl.light);
    g.set(hx + 4, hy - 7, cl.light);
  },
  /** Multica Helper:悬浮的星号核心(不握在手里,浮在身侧) */
  orb(g, hx, hy, cl) {
    const cx = hx + 2, cy = hy - 8;
    g.rows(cy - 2, [[cx - 1, cx + 1], [cx - 2, cx + 2], [cx - 2, cx + 2],
                    [cx - 2, cx + 2], [cx - 1, cx + 1]], MAT.dark);
    g.vline(cx, cy - 2, 5, W); g.hline(cx - 2, cy, 5, W);
    g.set(cx - 1, cy - 1, W); g.set(cx + 1, cy + 1, W);
    g.set(cx + 1, cy - 1, W); g.set(cx - 1, cy + 1, W);
    g.set(cx - 3, cy + 3, cl.base); g.set(cx + 3, cy - 3, cl.base);
  },
};
