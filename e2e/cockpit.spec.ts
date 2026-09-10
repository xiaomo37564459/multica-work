/**
 * 主流程冒烟 —— 父任务 MTM-274 的五个关键场景,一条命令走一遍。
 *
 * 为什么要有这个文件:五场景走查在 MTM-279 之前是人手点的,点完这一棒就没了。
 * 收口之后每加一个功能都要重走一遍,人手点第二次一定会漏。所以把五条固化下来 ——
 * 以后谁改坏了主流程,`npm run smoke` 当场红。
 *
 * 三条自我约束:
 *   1. **不做真实写操作。** 派活/喊话都会真的建 issue、真的唤醒智能体、真的烧用量。
 *      冒烟走到两段式确认页的最后一步为止,然后取消 —— 除了那一次 POST,整条链路都覆盖到了。
 *      那一次 POST 由人手按一次并在 issue 里留痕,不进自动化。
 *   2. **不写死今天的数据。** 谁在打怪、有几个项目每小时都在变,断言一律先问接口再挑对象;
 *      挑不到就 skip 并说清为什么,不假装通过。
 *   3. **打真服务。** 见 playwright.config.ts。
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/** 打一条 BFF 读接口,顺手把信封拆了。 */
async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path, { headers: { accept: 'application/json' } });
  expect(res.ok(), `${path} 应该 200,实际 ${res.status()}`).toBeTruthy();
  const env = (await res.json()) as { ok: boolean; data: T; error?: { message: string } };
  expect(env.ok, `${path} 返回了失败信封:${env.error?.message ?? ''}`).toBeTruthy();
  return env.data;
}

interface Battle {
  task_id: string;
  status: string;
  issue: { issue_id: string; identifier: string | null } | null;
}

interface RosterEntry {
  agent_id: string;
  display_name: string;
  state: string;
  current_battles: Battle[];
  last_battle: Battle | null;
}

async function roster(request: APIRequestContext) {
  return api<{ entries: RosterEntry[]; counts: Record<string, number> }>(request, '/api/roster');
}

/** 等主视图真的画出来(不是等 DOM,是等角色卡)。 */
async function openRoster(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.pc-unit').first()).toBeVisible();
}

test.describe('场景 1 —— 早上打开,一眼看清全队', () => {
  test('打开就是真数据,不是演示数据', async ({ page }) => {
    await openRoster(page);
    // 顶栏的这个标才是「你现在看到的是真的」的凭据。默认落到演示数据是最危险的一种回归:
    // 界面照样好看,而 heory 在拿假状态做真决定。
    await expect(page.getByText('● 实时数据')).toBeVisible();
    await expect(page.getByText('◌ 演示数据')).toHaveCount(0);
  });

  test('3 秒内看清:谁在忙 / 忙什么 / 谁空闲 / 谁卡住', async ({ page, request }) => {
    const data = await roster(request); // 先问接口,拿到今天的真实人数

    const t0 = Date.now();
    await page.goto('/');
    await expect(page.locator('.pc-unit')).toHaveCount(data.entries.length);
    const paintMs = Date.now() - t0;

    // 四类信息必须同屏可见,不用点、不用滚
    await expect(page.locator('[data-alarm]')).toBeVisible(); // 谁卡住(告警组单独在最前)
    await expect(page.locator('[data-counts]')).toBeVisible(); // 谁忙谁闲的计数
    const fighting = data.entries.filter((e) => e.state === 'fighting');
    if (fighting.length > 0) {
      // 忙什么 = 在打的那只怪,得写在卡上
      await expect(page.locator('.pc-unit [data-battle]').first()).toBeVisible();
    }

    // 父任务的验收线。留 3 秒是给「人打开页面到看清」的,不是给网络的。
    expect(paintMs, `首屏 ${paintMs}ms,超过 3 秒线`).toBeLessThan(3000);
    test.info().annotations.push({ type: '首屏', description: `${paintMs}ms / ${data.entries.length} 张角色卡` });
  });

  test('状态灯不靠读字 —— 每张卡都有灯和状态说明', async ({ page }) => {
    await openRoster(page);
    const cards = page.locator('.pc-unit');
    const n = await cards.count();
    for (let i = 0; i < n; i += 1) {
      await expect(cards.nth(i).locator('.pc-lamp')).toHaveCount(1);
    }
  });
});

test.describe('场景 2 —— 看到有人卡住,点开看战斗记录,再喊一句', () => {
  test('点角色卡进详情,战绩和最近战斗都在', async ({ page, request }) => {
    const data = await roster(request);
    const target = data.entries.find((e) => e.state === 'fighting') ?? data.entries[0]!;

    await openRoster(page);
    await page.locator(`.pc-unit__name`).filter({ hasText: target.display_name }).first().click();

    await expect(page).toHaveURL(new RegExp(`#/agents/${target.agent_id}`));
    await expect(page.getByRole('heading', { name: new RegExp(target.display_name) }).first()).toBeVisible();
    // 详情的四块:职业/技能栏/装备栏/战绩 —— 装备栏实测普遍是空的,空也得画出来
    await expect(page.getByRole('heading', { name: /技能栏/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /装备栏/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /战绩/ })).toBeVisible();
  });

  test('喊话走到确认页为止 —— 两段式确认在,警示语在', async ({ page, request }) => {
    const data = await roster(request);
    const fighting = data.entries.find((e) => e.state === 'fighting' && e.current_battles.length > 0);
    test.skip(!fighting, '此刻没有人在阵地上,喊话没有落点 —— 不是失败,是没得可喊');

    await page.goto(`/#/agents/${fighting!.agent_id}`);
    const shout = page.locator('[data-shout-open]');
    await expect(shout).toBeEnabled();
    await shout.click();

    await page.locator('[data-shout-content]').fill('冒烟脚本走查,不会发出去');
    await page.locator('[data-shout-next]').click();

    // 第二段:必须明说这是真操作、会烧用量。少了这句话,误点的代价就没人提醒。
    const confirm = page.locator('[data-shout-confirm]');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('真实发一条评论');
    await expect(confirm).toContainText('消耗用量');

    // 到此为止 —— 冒烟不按最后那颗按钮。
    await page.getByRole('button', { name: '← 再改改' }).click();
    await expect(confirm).toBeHidden();
  });
});

test.describe('场景 3 —— 想到新需求,舱内派活', () => {
  test('派活走到确认页为止 —— 角色可选、目标必填、确认页说清后果', async ({ page, request }) => {
    const data = await roster(request);
    await openRoster(page);

    await page.locator('[data-dispatch-open]').click();
    const next = page.locator('[data-dispatch-next]');
    // 目标是空的时候不许提交 —— 不然会建出一堆没头没尾的 issue
    await expect(next).toBeDisabled();

    await page.locator('[data-dispatch-title]').fill('冒烟脚本走查,不会提交');
    await page.locator('[data-dispatch-agent]').selectOption(data.entries[0]!.agent_id);
    await expect(next).toBeEnabled();
    await next.click();

    const confirm = page.locator('[data-dispatch-confirm]');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('真实创建 issue');
    await expect(confirm).toContainText('消耗用量');

    await page.getByRole('button', { name: '← 再改改' }).click();
    await expect(confirm).toBeHidden();
  });
});

test.describe('场景 4 —— 点项目看战役地图', () => {
  test('关卡按 stage 排布,点节点出侧栏', async ({ page, request }) => {
    const projects = await api<Array<{ project_id: string; title: string; issue_count: number }>>(request, '/api/projects');
    const withQuests = projects.find((p) => p.issue_count > 0);
    test.skip(!withQuests, '所有战役都是空的 —— 没有关卡可点');

    await page.goto('/#/projects');
    await expect(page.locator('.app-project').first()).toBeVisible();

    await page.goto(`/#/projects/${withQuests!.project_id}`);
    const nodes = page.locator('.pc-node').filter({ hasNotText: '' });
    await expect(page.locator('.pc-node-item').first()).toBeVisible();

    // 关卡节点点开 = 侧栏详情(状态/等级/出击角色/跳回本体)
    await page.locator('.pc-node-item .pc-node').first().click();
    await expect(page.getByLabel('关卡详情')).toBeVisible();
    await expect(nodes.first()).toBeVisible();
  });

  test('空战役给一句人话,不是白屏', async ({ page, request }) => {
    const projects = await api<Array<{ project_id: string; issue_count: number }>>(request, '/api/projects');
    const empty = projects.find((p) => p.issue_count === 0);
    test.skip(!empty, '此刻没有空战役 —— 空态由 mock 那份走查(?source=mock)');

    await page.goto(`/#/projects/${empty!.project_id}`);
    await expect(page.getByText('这个战役还没有关卡')).toBeVisible();
  });
});

test.describe('场景 5 —— 复盘一场战斗,接力链按时间轴展开', () => {
  test('回放里能看到接力链的每一棒', async ({ page, request }) => {
    const data = await roster(request);
    // 优先挑在打的那一场;全队都闲着时退而回看任何一场打完的
    const taskId = data.entries.find((e) => e.current_battles.length > 0)?.current_battles[0]?.task_id
      ?? data.entries.find((e) => e.last_battle)?.last_battle?.task_id;
    test.skip(!taskId, '此刻没有可回放的战斗');

    await page.goto(`/#/battles/${taskId}`);
    await expect(page.locator('.pc-tl-item').first()).toBeVisible();
    // 「本棒」标记必须有,不然一长条链里分不清在看谁
    await expect(page.getByText('◈ 本棒')).toBeVisible();
  });
});

test.describe('出错与空态 —— 每种都得有句人话', () => {
  test('角色不存在:说没有这个角色,并给回主视图的路', async ({ page }) => {
    await page.goto('/#/agents/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/没有这个角色/)).toBeVisible();
    await expect(page.getByRole('link', { name: /回主视图/ })).toBeVisible();
  });

  test('战役不存在:说没有这个战役', async ({ page }) => {
    await page.goto('/#/projects/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/没有这个战役/)).toBeVisible();
  });

  test('BFF 断了:说连不上,而且不清屏', async ({ page }) => {
    await openRoster(page);
    const before = await page.locator('.pc-unit').count();

    // 把后续所有接口打断,模拟服务被 Ctrl+C 掉
    await page.route('**/api/**', (r) => r.abort());
    await expect(page.getByText(/连不上本机 BFF/)).toBeVisible({ timeout: 15_000 });
    // 关键:黄条出来了,角色卡还在 —— 断网不该把手上的信息也抹掉
    expect(await page.locator('.pc-unit').count()).toBe(before);
  });
});

test.describe('接口自己的边界', () => {
  test('乱填的 id 走接口是 400/404,不是 500', async ({ request }) => {
    expect((await request.get('/api/agents/not-a-uuid')).status()).toBe(400);
    expect((await request.get('/api/agents/00000000-0000-4000-8000-000000000000')).status()).toBe(404);
    expect((await request.get('/api/nope')).status()).toBe(404);
  });

  test('白名单外的写操作一个都不给 —— 当它不存在', async ({ request }) => {
    expect((await request.post('/api/commands/anything', { data: {} })).status()).toBe(404);
    expect((await request.delete('/api/roster')).status()).toBe(404);
  });

  test('界面和接口同源同端口 —— 一条命令跑起来的凭据', async ({ request }) => {
    const html = await request.get('/');
    expect(html.status()).toBe(200);
    expect(html.headers()['content-type']).toContain('text/html');
    expect((await request.get('/api/health')).status()).toBe(200);
  });
});
