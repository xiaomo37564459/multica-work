/**
 * 主控色板 —— 全部立绘的唯一取色来源。
 *
 * 「13 个角色一眼看得出是同一套世界观」靠的不是画风自觉,是这条硬约束:
 *   1. 描边只有一种颜色(INK),所有角色共用;
 *   2. 每个角色只给一个身份基色,暗部/亮部由 shade()/tint() 统一推导;
 *   3. 所有暗部往同一个 SHADOW_HUE 偏,所有亮部往同一个 LIGHT_HUE 偏。
 * 第 3 条是关键 —— 统一的光源色温,是不同色相看起来「同一个世界」的原因。
 *
 * 新增角色时:只需给一个基色,不要自己调暗部亮部。
 */

export const INK = '#10121c';        // 全局描边,唯一
export const INK_SOFT = '#2a3050';   // 内部分界(衣褶、道具内线)

const SHADOW_HUE = '#1b1436';        // 所有暗部统一偏向的冷紫
const LIGHT_HUE = '#fff4dc';         // 所有亮部统一偏向的暖奶白

/** 肤色三档,全部同一暖橙灰系,只差明度 */
export const SKIN = {
  light: '#f0c8a0',
  mid: '#d69f74',
  deep: '#a8724c',
};

/** 发色 —— 覆盖全员,新增角色优先从这里挑 */
export const HAIR = {
  black: '#241f30',
  charcoal: '#3b3646',
  brown: '#5d3f2c',
  chestnut: '#8a4f2d',
  ash: '#8e8b9c',
  silver: '#c9ccdb',
  blonde: '#d8a94e',
  ink_blue: '#2c3a63',
};

/** 全员共用的裤装/鞋色 —— 下半身统一,身份色才能在上半身抢到注意力 */
export const PANTS = '#39405e';
export const SHOE = '#262b40';

/** 道具通用材质 */
export const MAT = {
  steel: '#9aa4bd',
  steel_hi: '#d7dcea',
  gold: '#e0b04a',
  gold_dk: '#8c6420',
  wood: '#7a5334',
  paper: '#efe6cf',
  glass: '#8fd8ea',
  dark: '#333a52',
};

/* ---------- 色彩推导 ---------- */

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
}
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** 暗部:往统一冷紫偏。level 1 = 常规暗部,2 = 深暗部 */
export function shade(hex, level = 1) {
  return mix(hex, SHADOW_HUE, level === 2 ? 0.6 : 0.36);
}

/** 亮部:往统一暖奶白偏 */
export function tint(hex, level = 1) {
  return mix(hex, LIGHT_HUE, level === 2 ? 0.55 : 0.28);
}

/** 由一个身份基色推导出完整三档布料色 */
export function ramp(base) {
  return { dark: shade(base, 2), mid: shade(base, 1), base, light: tint(base, 1) };
}

/**
 * 失败态调色:去色 + 压暗 + 轻微偏红。
 * 关键是「压暗但不压平」—— 明暗关系必须留住,否则角色糊成一坨看不出是谁。
 */
export function despair(hex) {
  const [r, g, b] = hex2rgb(hex);
  const lum = (0.3 * r + 0.59 * g + 0.11 * b) * 0.72;
  const grim = [lum * 1.12 + 12, lum * 0.86 + 4, lum * 0.94 + 12];
  // 保留 46% 原色。全灭成一个颜色确实更「惨」,但倒下的是谁就认不出来了 ——
  // 而看清「谁挂了」恰恰是这个产品最要紧的一件事,所以这里优先保辨识度。
  const keep = 0.46;
  return rgb2hex([
    grim[0] + (r * 0.66 - grim[0]) * keep,
    grim[1] + (g * 0.66 - grim[1]) * keep,
    grim[2] + (b * 0.66 - grim[2]) * keep,
  ]);
}

/** 卡住态:只降饱和 + 轻微压暗,比失败温和一档 */
export function drained(hex) {
  const [r, g, b] = hex2rgb(hex);
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const mixTo = (v) => (v + (lum - v) * 0.4) * 0.88;
  return rgb2hex([mixTo(r), mixTo(g), mixTo(b)]);
}
