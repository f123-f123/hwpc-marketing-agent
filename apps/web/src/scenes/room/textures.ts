/**
 * 体验空间的程序生成贴图（Canvas 绘制）。不使用任何外部图片，也不使用产品图片：
 * 这里画的只是木地板、墙面、地毯、窗外天空和示意屏幕画面。
 */
import * as THREE from "three";

/** 固定种子的伪随机数：每次打开空间都是同一间屋子。 */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  return c;
}

function texture(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** 橡木色地板：错缝铺设的长条板，每块色调略有不同，带细木纹。 */
export function woodFloor(): THREE.CanvasTexture {
  const rnd = seeded(7);
  return texture(
    canvas(1024, 1024, (g, w, h) => {
      const rows = 8;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 400;
        while (x < w) {
          const len = 360 + rnd() * 260;
          const l = 58 + rnd() * 8;
          g.fillStyle = `hsl(${30 + rnd() * 6} ${34 + rnd() * 8}% ${l}%)`;
          g.fillRect(x, r * rh, len, rh);
          // 木纹
          for (let i = 0; i < 14; i++) {
            g.strokeStyle = `rgba(90, 60, 30, ${0.04 + rnd() * 0.06})`;
            g.lineWidth = 1 + rnd() * 1.5;
            const y = r * rh + rnd() * rh;
            g.beginPath();
            g.moveTo(x, y);
            g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 10, x + len * 0.7, y + (rnd() - 0.5) * 10, x + len, y + (rnd() - 0.5) * 6);
            g.stroke();
          }
          g.fillStyle = "rgba(60, 40, 20, 0.35)";
          g.fillRect(x, r * rh, 2, rh);
          x += len;
        }
        g.fillStyle = "rgba(60, 40, 20, 0.28)";
        g.fillRect(0, r * rh, w, 2);
      }
    }),
    [3, 3],
  );
}

/** 浅色木纹（桌面、书架）。 */
export function lightWood(): THREE.CanvasTexture {
  const rnd = seeded(11);
  return texture(
    canvas(512, 512, (g, w, h) => {
      g.fillStyle = "#d8c3a2";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        g.strokeStyle = `rgba(120, 85, 45, ${0.03 + rnd() * 0.07})`;
        g.lineWidth = 0.6 + rnd() * 1.6;
        const y = rnd() * h;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 18, w * 0.7, y + (rnd() - 0.5) * 18, w, y + (rnd() - 0.5) * 10);
        g.stroke();
      }
    }),
  );
}

/** 墙面：暖白乳胶漆，带极轻的颗粒。 */
export function plaster(): THREE.CanvasTexture {
  const rnd = seeded(3);
  return texture(
    canvas(256, 256, (g, w, h) => {
      g.fillStyle = "#efebe5";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.35)" : "rgba(160,150,140,0.12)";
        g.fillRect(rnd() * w, rnd() * h, 1.2, 1.2);
      }
    }),
    [4, 2],
  );
}

/** 地毯：灰蓝底，浅色边框，手织纹理。 */
export function rug(): THREE.CanvasTexture {
  const rnd = seeded(5);
  return texture(
    canvas(1024, 720, (g, w, h) => {
      g.fillStyle = "#7d8a96";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
        g.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
      g.strokeStyle = "#d9d4c9";
      g.lineWidth = 16;
      g.strokeRect(40, 40, w - 80, h - 80);
      g.lineWidth = 4;
      g.strokeRect(76, 76, w - 152, h - 152);
    }),
  );
}

/** 软木板。 */
export function cork(): THREE.CanvasTexture {
  const rnd = seeded(9);
  return texture(
    canvas(512, 340, (g, w, h) => {
      g.fillStyle = "#b98e5c";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = `rgba(${rnd() > 0.5 ? "90,60,30" : "230,200,160"}, ${0.08 + rnd() * 0.12})`;
        g.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
    }),
  );
}

/** 窗外：上浅蓝下暖白的天空，远处一排楼和树的剪影。 */
export function sky(): THREE.CanvasTexture {
  const rnd = seeded(13);
  return texture(
    canvas(1024, 640, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#9cc6ea");
      sky.addColorStop(0.62, "#e6f0f6");
      sky.addColorStop(1, "#f6efe2");
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = "rgba(255,255,255,0.55)";
        const cx = rnd() * w;
        const cy = 60 + rnd() * 160;
        for (let k = 0; k < 5; k++) {
          g.beginPath();
          g.ellipse(cx + k * 34, cy + (rnd() - 0.5) * 12, 60 + rnd() * 40, 18 + rnd() * 10, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      let x = 0;
      while (x < w) {
        const bw = 60 + rnd() * 90;
        const bh = 80 + rnd() * 160;
        g.fillStyle = `rgba(150, 165, 180, ${0.45 + rnd() * 0.2})`;
        g.fillRect(x, h * 0.78 - bh, bw, bh + h);
        x += bw + 6;
      }
      g.fillStyle = "#93a98a";
      for (let i = 0; i < 60; i++) {
        g.beginPath();
        g.arc(rnd() * w, h * 0.8 + rnd() * 30, 20 + rnd() * 26, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
}

export type ScreenKind = "desktop" | "doc" | "phone" | "compare";

/** 示意屏幕画面：抽象壁纸 + 窗口块，不含任何真实界面或品牌标识。 */
export function screen(kind: ScreenKind, seed = 1): THREE.CanvasTexture {
  const rnd = seeded(seed);
  const [w, h] = kind === "phone" ? [256, 540] : [640, 400];
  return texture(
    canvas(w, h, (g) => {
      const bg = g.createLinearGradient(0, 0, w, h);
      const hue = 205 + rnd() * 30;
      bg.addColorStop(0, `hsl(${hue} 55% 62%)`);
      bg.addColorStop(1, `hsl(${hue + 40} 50% 32%)`);
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.ellipse(w * 0.75, h * 0.2, w * 0.5, h * 0.35, -0.4, 0, Math.PI * 2);
      g.fill();
      if (kind === "phone") {
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 4; c++) {
            g.fillStyle = `hsla(${rnd() * 360} 60% 70% / 0.9)`;
            g.beginPath();
            g.roundRect(26 + c * 56, 120 + r * 70, 38, 38, 10);
            g.fill();
          }
        return;
      }
      g.fillStyle = "rgba(20, 24, 31, 0.55)";
      g.fillRect(0, h - 26, w, 26);
      if (kind === "desktop" || kind === "compare") {
        g.fillStyle = "rgba(255,255,255,0.94)";
        g.beginPath();
        g.roundRect(w * 0.12, h * 0.14, w * 0.5, h * 0.56, 8);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.12)";
        for (let i = 0; i < 6; i++) g.fillRect(w * 0.16, h * 0.26 + i * 22, w * (0.3 + rnd() * 0.12), 8);
      }
      if (kind === "doc") {
        g.fillStyle = "rgba(255,255,255,0.96)";
        g.beginPath();
        g.roundRect(w * 0.18, h * 0.08, w * 0.64, h * 0.76, 8);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.14)";
        for (let i = 0; i < 9; i++) g.fillRect(w * 0.24, h * 0.18 + i * 26, w * (0.4 + rnd() * 0.12), 8);
      }
    }),
  );
}
