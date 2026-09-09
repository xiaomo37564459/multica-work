/**
 * 给 TypeScript 补的声明:像素资产是无构建的原生 JS 模块(苏绘 MTM-276),
 * 这里只声明前端用到的那几个出口,不重复描述内部结构。
 */

declare module '@pixel/sprites/roster.js' {
  export interface PixelRosterEntry {
    key: string;
    name: string;
    title: string;
    agentId: string;
    unit: string;
    note: string;
  }
  export const ROSTER: PixelRosterEntry[];
  export const byKey: Record<string, PixelRosterEntry>;
  export const byAgentId: Record<string, PixelRosterEntry>;
}

declare module '@pixel/sprites/index.js' {
  export function resolve(idOrKey: string): { key: string; name: string; title: string; unit: string } | null;
  export function toSpriteState(state: unknown): 'working' | 'idle' | 'stuck' | 'failed';
}

declare namespace React.JSX {
  interface IntrinsicElements {
    /** 苏绘的自定义元素立绘。agent 填名册 key 或 Multica agent id,state 直接传契约值 */
    'pixel-avatar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      agent?: string | undefined;
      state?: string | undefined;
      scale?: string | number | undefined;
      animate?: string | undefined;
    };
  }
}
