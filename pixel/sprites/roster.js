/**
 * 全员名册 —— 13 个角色,每人一条记录。
 *
 * 加新角色只需在这里加一条,不需要碰任何绘图代码:
 *   agentId 从 `multica agent list --output json` 取,是立绘和真实数据对上号的钥匙。
 *   unit    身份色,必须和 tokens.css 里的 --pc-unit-* 保持一致。
 *   head / outfit / prop 从 parts.js 里挑,或者去 parts.js 加一个新部件。
 * 详见 pixel/README.md「加一个新角色」。
 */
import { SKIN, HAIR, PANTS, ramp } from './palette.js';

export const ROSTER = [
  {
    key: 'shen', name: '沈执', title: '总指挥', agentId: '9f391cec-9557-4a69-a07b-d451bb6f62bd',
    unit: '#8b5cf6', head: 'commander', hair: HAIR.charcoal, skin: SKIN.mid,
    outfit: 'cape', prop: 'banner', propColor: '#e0b04a', accent: '#ffd45e',
    note: '披风立领 + 金肩章,手举指挥旗 —— 全场唯一有披风的人',
  },
  {
    key: 'ce', name: '策衡', title: '产品官', agentId: 'fddfce8a-61e7-425b-98de-ee0c30b6d825',
    unit: '#f2913d', head: 'parted', hair: HAIR.brown, skin: SKIN.light,
    outfit: 'vest', prop: 'clipboard', propColor: '#2f6fd0', accent: '#e8646e',
    note: '中分短发 + 耳后别笔,抱着画满线框的原型板',
  },
  {
    key: 'lin', name: '林澄', title: '需求官', agentId: '9e51a73e-3759-46d8-b098-b9b2b3af09e7',
    unit: '#6f97b0', head: 'bob', hair: HAIR.black, skin: SKIN.light,
    outfit: 'coat', prop: 'magnifier', propColor: '#d8564f', accent: '#5fb8d8',
    note: '波波头 + 圆框眼镜,举放大镜盯着需求看',
  },
  {
    key: 'zhou', name: '周构', title: '架构师', agentId: '335fc087-bd33-403c-817e-9e9d0c4dd00f',
    unit: '#4f7fe0', head: 'slick', hair: HAIR.ink_blue, skin: SKIN.mid,
    outfit: 'coat', prop: 'setsquare', propColor: '#8fd8ea', accent: '#8fd8ea',
    note: '全后梳 + 方框眼镜,手里一把三角尺',
  },
  {
    key: 'han', name: '韩程', title: '后端', agentId: 'a113d661-ed16-4656-a30d-cadd4ae39c2a',
    unit: '#d9a520', head: 'cap', hair: HAIR.black, skin: SKIN.mid,
    outfit: 'hoodie', prop: 'dbstack', propColor: '#3fb8a8', accent: '#d9a520',
    note: '反戴帽 + 头戴耳机,扛着三层数据库柱',
  },
  {
    key: 'xu', name: '许界', title: '前端', agentId: 'b6a0e9a1-56d4-4273-bc90-07994f876961',
    unit: '#38b8d8', head: 'curly', hair: HAIR.chestnut, skin: SKIN.light,
    outfit: 'scarf', prop: 'browser', propColor: '#6b4fd8', accent: '#38b8d8',
    note: '蓬松卷发 + 彩虹围巾(全场唯一多色部件),托着一扇浏览器窗口',
  },
  {
    key: 'su', name: '苏绘', title: 'UI/UX', agentId: 'f01791eb-19dd-4844-82ea-b9c94f384682',
    unit: '#e35fa8', head: 'beret', hair: HAIR.black, skin: SKIN.light,
    outfit: 'apron', prop: 'brush', propColor: '#3fd0c0', accent: '#f2c14e',
    note: '歪戴金色贝雷帽 + 长发过肩,围裙口袋插着三支颜料,握画笔',
  },
  {
    key: 'tang', name: '唐端', title: '移动端', agentId: '74c7e6c0-3e25-4fec-9078-d692d74921e2',
    unit: '#b5713f', head: 'crop', hair: HAIR.black, skin: SKIN.deep,
    outfit: 'hoodie', prop: 'phone', propColor: '#7fd4a8', accent: '#7fd4a8',
    note: '锯齿寸头 + 连帽衫,手里永远举着一台手机',
  },
  {
    key: 'gu', name: '顾检', title: '质量官', agentId: '587ddd7f-9cc2-4d9a-83c6-52444217c529',
    unit: '#2e7fa8', head: 'goggles', hair: HAIR.charcoal, skin: SKIN.mid,
    outfit: 'armor', prop: 'shield', propColor: '#49c4d8', accent: '#8fd8ea',
    note: '护目镜推额头 + 胸甲(全场唯一硬甲),持带勾的盾牌',
  },
  {
    key: 'liang', name: '梁运', title: '运维', agentId: '06148d0c-f9ba-4f22-973b-1e9a704ad912',
    unit: '#e8762c', head: 'hardhat', hair: HAIR.brown, skin: SKIN.mid,
    outfit: 'hivis', prop: 'wrench', propColor: '#c9d0e0', accent: '#e8762c',
    note: '安全帽 + 反光背心,拎一把扳手 —— 最好认的剪影',
  },
  {
    key: 'qin', name: '秦划', title: '项目经理', agentId: '5d2cd6a8-555f-484e-adea-1938afde444f',
    unit: '#3f9e63', head: 'bun', hair: HAIR.brown, skin: SKIN.light,
    outfit: 'vest', prop: 'gantt', propColor: '#2f5fa8', accent: '#e8762c',
    note: '顶髻 + 马甲领带,举着一块甘特图板',
  },
  {
    key: 'mika', name: 'Mika', title: 'Chief of Staff', agentId: 'c1a419dd-8e9e-4d9c-b0a0-379b34da2cd3',
    unit: '#f0a3d8', head: 'horn', hair: HAIR.silver, skin: SKIN.light,
    outfit: 'dress', prop: 'wand', propColor: '#a06fe8', accent: '#f0a3d8',
    note: '独角 + 银色长发 + 外扩裙摆,握星杖 —— 全场唯一有角的角色',
  },
  {
    key: 'help', name: 'Multica Helper', title: '内置助手', agentId: '34f07ec5-36ac-48b1-8614-8f0e70641174',
    unit: '#a8b2c4', head: 'visor', hair: HAIR.ash, skin: '#b6bfd2', pants: '#5b6480',
    outfit: 'shell', prop: 'orb', propColor: '#7fd4e8', accent: '#a8b2c4',
    note: '机体不是人:光面头 + 横向面罩 + 天线,身侧浮着星号核心',
  },
];

/**
 * 把名册里的基色展开成完整三档色,绘图时直接用。
 * 暗部/亮部一律由 ramp() 推,不允许在名册里手写 —— 手写就会漂色。
 */
export function unitColors(c) {
  return {
    cloth: ramp(c.unit),
    pants: ramp(c.pants || PANTS),
    prop: ramp(c.propColor || c.unit),
    skin: ramp(c.skin),
    hair: c.hair,
    accent: c.accent,
  };
}

export const byKey = Object.fromEntries(ROSTER.map((c) => [c.key, c]));
export const byAgentId = Object.fromEntries(ROSTER.map((c) => [c.agentId, c]));
