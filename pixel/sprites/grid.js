/**
 * 像素画布 —— 一个 N×N 的颜色格子,配一套只认整数坐标的绘图原语。
 * 所有立绘都画在这上面,不用浏览器的抗锯齿绘图,所以永远不会出现糊边。
 */
export class Grid {
  constructor(n) {
    this.n = n;
    this.d = new Array(n * n).fill(null);
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.n && y < this.n; }
  get(x, y) { return this.in(x, y) ? this.d[y * this.n + x] : null; }
  set(x, y, c) { if (c && this.in(x, y)) this.d[y * this.n + x] = c; }
  /** 只在空格子上画 —— 用于补描边/垫底,不覆盖已画好的内容 */
  under(x, y, c) { if (c && this.in(x, y) && !this.d[y * this.n + x]) this.d[y * this.n + x] = c; }
  clear(x, y) { if (this.in(x, y)) this.d[y * this.n + x] = null; }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { this.rect(x, y, 1, h, c); }

  /** 用「每行 x 区间」的方式描一个不规则形状,画圆头/斜肩最省事 */
  rows(yStart, spans, c) {
    spans.forEach(([x0, x1], i) => { if (x1 >= x0) this.hline(x0, yStart + i, x1 - x0 + 1, c); });
  }

  /** 以 axis 为竖轴把左半边镜像到右半边(角色左右对称的部分用这个,保证不手抖) */
  mirrorX(axis) {
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        const c = this.get(x, y);
        if (c) this.set(Math.round(2 * axis - x), y, c);
      }
    }
  }

  /** 整体平移(做姿势偏移用) */
  shifted(dx, dy) {
    const out = new Grid(this.n);
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) out.set(x + dx, y + dy, this.get(x, y));
    return out;
  }

  /** 把另一张画布叠上来,空像素透明 */
  blit(other, dx = 0, dy = 0) {
    for (let y = 0; y < other.n; y++) for (let x = 0; x < other.n; x++) this.set(x + dx, y + dy, other.get(x, y));
    return this;
  }

  /** 逐色重映射 —— 四态调色(失败压暗、卡住褪色)统一走这里 */
  mapColors(fn, skip = []) {
    for (let i = 0; i < this.d.length; i++) {
      const c = this.d[i];
      if (c && !skip.includes(c)) this.d[i] = fn(c);
    }
    return this;
  }

  /**
   * 自动描边 —— 风格统一的核心一招。
   * 把所有实心像素的正交空邻居涂成同一个 ink 色。
   * 13 个角色由不同的部件拼出来,但描边永远由这一个函数完成,
   * 所以线条粗细、包裹方式绝不会因人而异。
   */
  outline(ink) {
    const add = [];
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
    }
    add.forEach(([x, y]) => this.set(x, y, ink));
    return this;
  }

  /** 非空像素的包围盒,没有内容返回 null(摔道具时要用) */
  bbox() {
    let x0 = this.n, y0 = this.n, x1 = -1, y1 = -1;
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        if (!this.get(x, y)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /** 写进 ImageData(渲染器用) */
  drawInto(imageData, ox, oy, scale = 1) {
    const { data, width } = imageData;
    for (let y = 0; y < this.n; y++) {
      for (let x = 0; x < this.n; x++) {
        const c = this.get(x, y);
        if (!c) continue;
        const v = parseInt(c.slice(1), 16);
        const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = ox + x * scale + sx, py = oy + y * scale + sy;
            const idx = (py * width + px) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
          }
        }
      }
    }
  }
}
