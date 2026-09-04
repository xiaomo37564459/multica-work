#!/usr/bin/env node
/**
 * 把立绘导出成 PNG —— 给不跑浏览器的场合用(贴文档、发评论附件、离线核对)。
 * 网页本身不需要它:页面在运行时直接生成图集,不依赖任何构建产物。
 *
 * 用法:
 *   node pixel/tools/export-png.js            → 导出图集 + 每个角色 4 态单图到 pixel/dist/
 *   node pixel/tools/export-png.js --scale 8  → 放大 8 倍导出
 *
 * 输出目录 pixel/dist/ 已在 .gitignore 里 —— 导出的图片不进仓库。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROSTER } from '../sprites/roster.js';
import { drawSprite, STATES, FRAMES } from '../sprites/renderer.js';
import { G } from '../sprites/body.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'dist');

/* ---------- 极简 PNG 编码器(只写 8-bit RGBA,够用了) ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 把 Grid 铺进 RGBA 缓冲 ---------- */

function blitGrid(rgba, width, grid, ox, oy, scale, bg) {
  for (let y = 0; y < grid.n; y++) {
    for (let x = 0; x < grid.n; x++) {
      const c = grid.get(x, y) || bg;
      if (!c) continue;
      const v = parseInt(c.slice(1), 16);
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((oy + y * scale + sy) * width + ox + x * scale + sx) * 4;
          rgba[i] = (v >> 16) & 255; rgba[i + 1] = (v >> 8) & 255; rgba[i + 2] = v & 255; rgba[i + 3] = 255;
        }
      }
    }
  }
}

/* ---------- 主流程 ---------- */

const scaleArg = process.argv.indexOf('--scale');
const scale = scaleArg > -1 ? Number(process.argv[scaleArg + 1]) : 4;
const bgArg = process.argv.indexOf('--bg');
const bg = bgArg > -1 ? process.argv[bgArg + 1] : null;

mkdirSync(OUT, { recursive: true });

// 1) 图集:行 = 角色,列 = 状态 × 帧
{
  const cols = STATES.length * FRAMES, rows = ROSTER.length;
  const w = cols * G * scale, h = rows * G * scale;
  const rgba = Buffer.alloc(w * h * 4);
  ROSTER.forEach((c, r) => STATES.forEach((st, si) => {
    for (let f = 0; f < FRAMES; f++) {
      blitGrid(rgba, w, drawSprite(c, st, f), (si * FRAMES + f) * G * scale, r * G * scale, scale, bg);
    }
  }));
  writeFileSync(join(OUT, 'sheet.png'), encodePNG(w, h, rgba));
  console.log(`sheet.png  ${w}x${h}  ${rows} 角色 × ${STATES.length} 态 × ${FRAMES} 帧`);
}

// 2) 每个角色一张四态条:方便逐个核对
for (const c of ROSTER) {
  const w = STATES.length * G * scale, h = G * scale;
  const rgba = Buffer.alloc(w * h * 4);
  STATES.forEach((st, i) => blitGrid(rgba, w, drawSprite(c, st, 0), i * G * scale, 0, scale, bg));
  writeFileSync(join(OUT, `${c.key}.png`), encodePNG(w, h, rgba));
}
console.log(`已写出 ${ROSTER.length} 张角色四态条 → pixel/dist/`);
