/**
 * 样张页的装配脚本。
 * 这里的数据全是写死的假数据 —— 只为了把组件和状态摆出来给人看,
 * 不连任何真实接口。真数据是韩程那一棒的事。
 */
import { ROSTER, STATES } from '../sprites/index.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const avatar = (key, state, scale, animate = true) => {
  const a = document.createElement('pixel-avatar');
  a.setAttribute('agent', key);
  a.setAttribute('state', state);
  if (scale) a.setAttribute('scale', scale);
  if (!animate) a.setAttribute('animate', 'false');
  return a;
};

const STATE_CN = { working: '交战中', idle: '待命', stuck: '卡住', failed: '失败' };

/* ---------------- 换主题 ---------------- */

function initThemes() {
  const btns = [...document.querySelectorAll('[data-theme-btn]')];
  const set = (t) => {
    document.documentElement.dataset.theme = t;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
  };
  btns.forEach((b) => b.addEventListener('click', () => set(b.dataset.themeBtn)));
  set(document.documentElement.dataset.theme || 'deep-space');
}

/* ---------------- ① 主视图 ---------------- */

// 假的战况:凑齐四种状态,好让一屏里同时看到四种边框
const DECK = [
  { key: 'shen', state: 'working', quest: 'MTM-274 指挥舱一期收口', mins: 42, retry: 0, lv: 4 },
  { key: 'zhou', state: 'working', quest: 'MTM-275 定技术栈和数据契约', mins: 18, retry: 0, lv: 4 },
  { key: 'su', state: 'working', quest: 'MTM-276 像素视觉:定风格 + 立绘 + 皮肤', mins: 63, retry: 0, lv: 4 },
  { key: 'han', state: 'stuck', quest: 'MTM-278 聚合服务接真数据', mins: 26, retry: 1, lv: 3 },
  { key: 'gu', state: 'failed', quest: 'MTM-271 验收上一版交付', mins: 9, retry: 2, lv: 3 },
  { key: 'xu', state: 'working', quest: 'MTM-279 首屏 3 秒 + 轮询稳态', mins: 7, retry: 0, lv: 2 },
  { key: 'ce', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'lin', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'tang', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'liang', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'qin', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'mika', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
  { key: 'help', state: 'idle', quest: null, mins: 0, retry: 0, lv: 0 },
];

function levelPips(lv, urgent, label = '怪物等级') {
  const pips = [1, 2, 3, 4].map((i) => `<i class="pc-lv__pip ${i <= lv ? 'pc-lv__pip--on' : ''}"></i>`).join('');
  return `<span class="pc-lv ${urgent ? 'pc-lv--urgent' : ''}">${label ? label + ' ' : ''}${pips}</span>`;
}

function unitCard(d) {
  const c = ROSTER.find((r) => r.key === d.key);
  const card = el('article', `pc-unit pc-unit--${d.state}`);
  card.style.setProperty('--pc-unit-c', c.unit);

  card.append(el('div', 'pc-unit__band'));

  const head = el('div', 'pc-unit__head');
  head.append(
    el('span', 'pc-lamp pc-lamp--' + d.state),
    el('span', 'pc-unit__name', c.name),
    el('span', 'pc-unit__title', c.title),
  );
  card.append(head);

  const body = el('div', 'pc-unit__body');
  const stage = el('div', 'pc-sprite-stage');
  stage.append(avatar(c.key, d.state, 3));
  body.append(stage);

  const meta = el('div', 'pc-unit__meta');
  meta.append(el('div', 'pc-unit__quest', d.quest || '<span class="pc-dim">待命中 · 没有在打的怪</span>'));
  if (d.quest) {
    meta.append(el('div', null, levelPips(d.lv, d.lv >= 4)));
    const bar = el('div', `pc-bar pc-bar--${d.state}`);
    const fill = el('div', 'pc-bar__fill');
    fill.style.setProperty('--pc-bar-v', Math.min(95, d.mins * 1.5));
    bar.append(fill);
    meta.append(bar);
    meta.append(el('div', 'pc-unit__stats',
      `<span>已耗时 <b class="pc-num pc-hi">${d.mins}</b> 分</span><span>重试 <b class="pc-num pc-hi">${d.retry}</b> 次</span>`));
  } else {
    meta.append(el('div', 'pc-unit__stats', '<span>今日 3 战 3 胜</span>'));
  }
  body.append(meta);
  card.append(body);
  return card;
}

/* ---------------- ② 立绘总表 ---------------- */

function buildRoster() {
  const box = $('#roster');
  const head = el('div', 'sg-roster__head');
  head.append(el('span', null, '角色 / 职业'));
  STATES.forEach((s) => head.append(el('span', null, `${STATE_CN[s]}<br><code>${s}</code>`)));
  box.append(head);

  ROSTER.forEach((c) => {
    const row = el('div', 'sg-roster__row');
    const who = el('div', 'sg-roster__who');
    const bar = el('div', 'sg-roster__bar');
    bar.style.background = c.unit;
    who.append(bar, el('b', null, `${c.name}｜${c.title}`), el('span', null, c.note));
    row.append(who);
    STATES.forEach((s) => {
      const cell = el('div', 'sg-roster__cell');
      cell.append(avatar(c.key, s, 3));
      row.append(cell);
    });
    box.append(row);
  });
}

/* ---------------- ③ 色板 ---------------- */

function swatch(name, cssVar, desc) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const s = el('div', 'sg-sw');
  const chip = el('div', 'sg-sw__chip');
  chip.style.background = `var(${cssVar})`;
  chip.dataset.var = cssVar;
  s.append(chip, el('div', 'sg-sw__txt', `<b>${name}</b><code>${desc || v}</code>`));
  return s;
}

function buildSwatches() {
  const st = $('#sw-state');
  [['干活', '--pc-st-working'], ['空闲', '--pc-st-idle'], ['卡住', '--pc-st-stuck'], ['失败', '--pc-st-failed']]
    .forEach(([n, v]) => st.append(swatch(n, v, v)));

  const base = $('#sw-base');
  [['页面底', '--pc-bg-0'], ['面板', '--pc-bg-1'], ['卡片', '--pc-bg-2'], ['凸起', '--pc-bg-3'],
   ['分割线', '--pc-line'], ['强调', '--pc-accent'], ['正文', '--pc-text'], ['高亮字', '--pc-text-hi']]
    .forEach(([n, v]) => base.append(swatch(n, v, v)));

  const unit = $('#sw-unit');
  ROSTER.forEach((c) => {
    const s = el('div', 'sg-sw');
    const chip = el('div', 'sg-sw__chip');
    chip.style.background = c.unit;
    s.append(chip, el('div', 'sg-sw__txt', `<b>${c.name}</b><code>${c.unit}</code>`));
    unit.append(s);
  });
}

/* ---------------- ④ 组件 ---------------- */

function buildBits() {
  const lamps = $('#lamps');
  STATES.forEach((s) => {
    const w = el('span', 'sg-row');
    w.style.gap = '8px';
    w.append(el('span', `pc-lamp pc-lamp--${s}`), el('span', 'sg-label', STATE_CN[s]));
    lamps.append(w);
  });

  const chips = $('#chips');
  STATES.forEach((s) => {
    const c = el('span', `pc-status pc-status--${s}`);
    c.append(el('span', `pc-lamp pc-lamp--${s}`), document.createTextNode(STATE_CN[s]));
    chips.append(c);
  });

  const lv = $('#levels');
  lv.append(el('span', 'sg-label pc-dim', '怪物等级 = issue 优先级:'));
  [['低', 1, false], ['中', 2, false], ['高', 3, false], ['紧急', 4, true]]
    .forEach(([n, v, u]) => lv.append(el('span', 'sg-label', `${n} ${levelPips(v, u, '')}`)));
}

/* ---------------- ⑤ 战役地图 ---------------- */

const MAP = [
  { stage: 1, nodes: [
    { t: 'MTM-275 地基', s: 'done' },
    { t: 'MTM-276 像素视觉', s: 'active', pilot: 'su' },
  ] },
  { stage: 2, nodes: [{ t: 'MTM-277 前端初版', s: 'locked' }] },
  { stage: 3, nodes: [{ t: 'MTM-278 真数据', s: 'locked' }] },
  { stage: 4, nodes: [{ t: 'MTM-279 收尾打磨', s: 'locked' }, { t: 'MTM-271 上一版验收', s: 'failed' }] },
];

const NODE_MARK = { done: '✓', active: '▶', failed: '✕', locked: '锁' };

function buildMap() {
  const box = $('#map');
  MAP.forEach((row, ri) => {
    const r = el('div', 'pc-stage-row');
    r.append(el('span', 'pc-stage-label', `第 ${row.stage} 关`));
    row.nodes.forEach((n, i) => {
      if (i) r.append(el('span', `pc-link ${n.s === 'done' ? 'pc-link--done' : ''}`));
      const item = el('div', 'pc-node-item');
      const node = el('button', `pc-node pc-node--${n.s}`, NODE_MARK[n.s]);
      node.title = n.t;
      if (n.pilot) {
        const pilot = el('span', 'pc-face pc-face--sm pc-node__pilot');
        pilot.append(avatar(n.pilot, 'working', null, true));
        node.append(pilot);
      }
      item.append(node, el('span', 'pc-node-item__title', n.t));
      r.append(item);
    });
    box.append(r);
  });
}

/* ---------------- ⑥ 时间轴 ---------------- */

const TL = [
  { who: 'lin', when: '09:12', dot: 'done', what: '把「想看清智能体在干嘛」拆成 9 条功能 + 5 个验收场景,传给沈执' },
  { who: 'shen', when: '09:31', dot: 'done', what: '拆四拍串行,第一拍两条并行派出去' },
  { who: 'zhou', when: '09:56', dot: 'done', what: '定了技术栈和聚合数据契约,仓库主干立起来' },
  { who: 'su', when: '10:04', dot: 'active', what: '像素风格 + 13 角色 4 态立绘 + UI 皮肤(进行中)' },
  { who: 'gu', when: '—', dot: 'failed', what: '上一轮验收没过:截图不是真跑出来的,打回重交' },
];

function buildTimeline() {
  const box = $('#timeline');
  TL.forEach((t) => {
    const c = ROSTER.find((r) => r.key === t.who);
    const item = el('div', 'pc-tl-item');
    const rail = el('div', 'pc-tl-rail');
    rail.append(el('span', `pc-tl-dot pc-tl-dot--${t.dot}`), el('span', 'pc-tl-line'));
    const body = el('div', 'pc-tl-body');
    const head = el('div', 'sg-row');
    head.style.gap = '8px';
    const st = t.dot === 'failed' ? 'failed' : t.dot === 'active' ? 'working' : 'idle';
    const face = el('span', `pc-face pc-face--${st}`);
    face.append(avatar(c.key, st, null, false));
    head.append(face, el('span', 'pc-tl-who', `${c.name}｜${c.title}`), el('span', 'pc-tl-when', t.when));
    body.append(head, el('div', 'pc-tl-what', t.what));
    item.append(rail, body);
    box.append(item);
  });
}

/* ---------------- ⑦ 关键状态 ---------------- */

function buildStates() {
  const box = $('#states');
  const wrap = (cap, node) => {
    const s = el('div', 'sg-state');
    s.append(el('div', 'sg-state__cap', cap), node);
    box.append(s);
  };

  wrap('<b>默认</b> · 有数据,正常渲染', unitCard(DECK[1]));

  const load = el('div', 'pc-frame sg-stack');
  ['40%', '100%', '70%', '55%'].forEach((w, i) => {
    const k = el('div', 'pc-skel');
    k.style.height = i === 1 ? '48px' : '16px';
    k.style.width = w;
    load.append(k);
  });
  wrap('<b>加载中</b> · 第一次拉数据,骨架一格一格闪', load);

  wrap('<b>空态</b> · 从来没派过活',
    el('div', 'pc-empty', '还没有出战记录<br><span class="pc-dim">点右上角「派活」给一个角色下第一个任务</span>'));

  wrap('<b>异常</b> · 拉不到数据',
    el('div', 'pc-error', 'multica CLI 没响应<br><span class="pc-dim">上次成功刷新:2 分钟前 · 正在每 5 秒重试</span>'));

  const dis = el('div', 'pc-frame sg-stack');
  dis.append(
    el('div', 'sg-label pc-dim', '角色正在打别的怪,派活入口关掉:'),
    el('button', 'pc-btn pc-btn--primary', '派 活'),
  );
  dis.lastChild.disabled = true;
  dis.append(el('div', 'sg-label pc-dim', '禁用不只是变淡,还打了斜纹 —— 灰度打印也看得出不能点'));
  wrap('<b>禁用</b> · 当前不能操作', dis);

  const ok = el('div', 'pc-frame sg-stack');
  const okChip = el('span', 'pc-status pc-status--working');
  okChip.append(el('span', 'pc-lamp pc-lamp--working'), document.createTextNode('已送达'));
  ok.append(el('div', 'sg-label pc-hi', '喊话已落成 MTM-278 的评论,韩程已被唤醒'), okChip);
  wrap('<b>成功</b> · 写操作真的生效了', ok);

  const perm = el('div', 'pc-frame sg-stack');
  perm.append(
    el('div', 'sg-label pc-hi', '只读模式'),
    el('div', 'sg-label pc-dim', '没有 workspace owner 凭据时,派活和喊话两个写操作按钮不显示,其余照常看。'),
  );
  const row = el('div', 'sg-row');
  row.append(el('button', 'pc-btn pc-btn--ghost', '跳回 Multica'), el('span', 'sg-label pc-dim', '(写操作入口已隐藏)'));
  perm.append(row);
  wrap('<b>权限差异</b> · 没有写权限时', perm);
}

/* ---------------- 启动 ---------------- */

initThemes();
DECK.forEach((d) => $('#deck').append(unitCard(d)));
buildRoster();
buildSwatches();
buildBits();
buildMap();
buildTimeline();
buildStates();
document.body.dataset.ready = '1';
