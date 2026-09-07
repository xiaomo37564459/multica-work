/**
 * 迷你 hash 路由 —— 五屏就五条地址,不值得为此引一个路由库。
 * hash 路由的好处:构建产物任何静态服务器都能托管,刷新不需要服务端改写。
 */
import { useEffect, useState } from 'react';

export type Route =
  | { screen: 'roster' }
  | { screen: 'agent'; id: string }
  | { screen: 'projects' }
  | { screen: 'campaign'; id: string }
  | { screen: 'replay'; taskId: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'agents' && parts[1]) return { screen: 'agent', id: parts[1] };
  if (parts[0] === 'projects' && parts[1]) return { screen: 'campaign', id: parts[1] };
  if (parts[0] === 'projects') return { screen: 'projects' };
  if (parts[0] === 'battles' && parts[1]) return { screen: 'replay', taskId: parts[1] };
  return { screen: 'roster' };
}

export function hashOf(r: Route): string {
  switch (r.screen) {
    case 'roster': return '#/';
    case 'agent': return `#/agents/${encodeURIComponent(r.id)}`;
    case 'projects': return '#/projects';
    case 'campaign': return `#/projects/${encodeURIComponent(r.id)}`;
    case 'replay': return `#/battles/${encodeURIComponent(r.taskId)}`;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
