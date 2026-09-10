/**
 * 指挥舱外壳:顶栏(导航 + 数据源)+ 五屏路由 + 页脚。
 *
 * 数据源:BFF 端出来的界面(`npm start` → http://127.0.0.1:4780/)默认**真数据**;
 * Vite 开发服(`cd web && npm run dev`)默认 mock,免得改个样式就打真接口。
 * 两边都能用 `?source=mock` / `?source=live` 手动切。
 * mock 模式下顶栏多一个「演示」菜单:黄条 / 过期 / 重演加载相位,给验收走查用。
 */
import { useMemo, useState } from 'react';
import type { CockpitApi } from './api/api.ts';
import { pickSource } from './api/api.ts';
import { createMockApi } from './mock/api.ts';
import { createLiveApi } from './api/live.ts';
import { useRoute } from './router.ts';
import { RosterScreen } from './screens/RosterScreen.tsx';
import { AgentScreen } from './screens/AgentScreen.tsx';
import { ProjectsScreen } from './screens/ProjectsScreen.tsx';
import { CampaignScreen } from './screens/CampaignScreen.tsx';
import { ReplayScreen } from './screens/ReplayScreen.tsx';

function switchSourceHref(to: 'mock' | 'live'): string {
  const url = new URL(window.location.href);
  url.searchParams.set('source', to);
  return url.toString();
}

function DemoMenu(props: { api: CockpitApi; onChange: () => void }) {
  const demo = props.api.demo;
  if (!demo) return null;
  return (
    <details className="app-demo">
      <summary className="pc-btn pc-btn--ghost pc-btn--sm">🎛 演示</summary>
      <div className="pc-frame pc-panel app-demo__menu">
        <label>
          <input
            type="checkbox"
            defaultChecked={demo.degraded}
            onChange={(e) => { demo.degraded = e.currentTarget.checked; props.onChange(); }}
          /> 演示「数据源降级」黄条
        </label>
        <label>
          <input
            type="checkbox"
            defaultChecked={demo.stale}
            onChange={(e) => { demo.stale = e.currentTarget.checked; props.onChange(); }}
          /> 演示「数据可能过期」
        </label>
        <button
          type="button"
          className="pc-btn pc-btn--sm"
          onClick={() => { demo.resetLoading(); props.onChange(); }}
          title="重演开机头几秒的「战绩加载中」骨架屏(许界、梁运两人)"
        >
          ⟲ 重演加载相位
        </button>
        <p className="pc-dim">这些开关只影响 mock 演示数据,不碰任何真实系统。</p>
      </div>
    </details>
  );
}

export default function App() {
  // 构建产物 = BFF 端出来的那一份,同源就有 /api,默认吃真数据;dev server 默认 mock。
  const fallback = import.meta.env.PROD ? 'live' : 'mock';
  const source = useMemo(
    () => pickSource(window.location.search, localStorage.getItem('cockpit_source'), fallback),
    [fallback],
  );
  const api = useMemo<CockpitApi>(() => (source === 'live' ? createLiveApi() : createMockApi()), [source]);
  const route = useRoute();
  const [demoTick, setDemoTick] = useState(0);

  const nav = [
    { hash: '#/', label: '⌂ 指挥舱', active: route.screen === 'roster' || route.screen === 'agent' || route.screen === 'replay' },
    { hash: '#/projects', label: '🗺 战役地图', active: route.screen === 'projects' || route.screen === 'campaign' },
  ];

  return (
    <div className="pc-root pc-scan app">
      <header className="app-top">
        <a className="app-brand" href="#/">
          <span className="app-brand__sig" aria-hidden>◤◢</span> AETHERLAB 指挥舱
        </a>
        <nav className="app-nav">
          {nav.map((n) => (
            <a key={n.hash} className={`pc-btn pc-btn--sm ${n.active ? '' : 'pc-btn--ghost'}`} href={n.hash}>{n.label}</a>
          ))}
        </nav>
        <span className="app-spacer" />
        {source === 'mock' ? (
          <>
            <span className="app-chip app-chip--mock" title="当前是演示数据:结构严格等于周构契约,后面换真数据只换数据源">
              ◌ 演示数据
            </span>
            <DemoMenu api={api} onChange={() => setDemoTick((n) => n + 1)} />
            <a className="pc-btn pc-btn--ghost pc-btn--sm" href={switchSourceHref('live')} title="切到本机 BFF 的真数据(要先在仓库根跑 npm start)">
              ⇄ 切真数据
            </a>
          </>
        ) : (
          <>
            <span className="app-chip" title="数据来自本机 BFF(127.0.0.1:4780)">● 实时数据</span>
            <a className="pc-btn pc-btn--ghost pc-btn--sm" href={switchSourceHref('mock')}>⇄ 切演示</a>
          </>
        )}
      </header>

      <main className="app-main" data-demo-tick={demoTick}>
        {route.screen === 'roster' && <RosterScreen api={api} />}
        {route.screen === 'agent' && <AgentScreen api={api} agentId={route.id} />}
        {route.screen === 'projects' && <ProjectsScreen api={api} />}
        {route.screen === 'campaign' && <CampaignScreen api={api} projectId={route.id} />}
        {route.screen === 'replay' && <ReplayScreen api={api} taskId={route.taskId} />}
      </main>

      <footer className="app-foot pc-dim">
        契约 <code className="app-code">src/contract/types.ts</code> · 皮肤 <code className="app-code">pixel/</code>(主题 A 深空指挥舱)
        · 派活/喊话是真实写操作,仅在「实时数据」模式开放,提交前都有确认页
      </footer>
    </div>
  );
}
