/**
 * 入口:装载苏绘的皮肤(token + 组件 + 立绘自定义元素),再挂 React。
 * 立绘模块只在真浏览器里 import —— 测试(jsdom)不会走到这个文件。
 */
import { createRoot } from 'react-dom/client';
import '@pixel/tokens.css';
import '@pixel/components.css';
import '@pixel/sprites/index.js';
import './app.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
