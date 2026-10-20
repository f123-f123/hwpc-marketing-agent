/**
 * 体验空间的三维布置：一间带窗的书房兼起居空间（单位：米）。
 * 相机站在房间中部、视线高度 1.5 m；四个热点各对应一处真实可辨认的陈设：
 *   书桌（笔记本 + 外接显示器）→ 多屏协同；窗边小桌（笔记本 + 手机）→ 文件互传；
 *   后方长桌上三台笔记本 → 候选比较；软木板 → 我的方案。
 * 设备都是不带品牌标识的示意模型，屏幕是程序画的示意画面，不是产品图片。
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import * as T from "./textures";

export const EYE = new THREE.Vector3(0, 1.5, 0.9);
const W = 3.6; // 半宽（x）
const D = 3.2; // 半深（z）
const H = 2.8;

/** 热点锚点（世界坐标）。scenes/src/space.ts 里的 yaw/pitch 必须与这里一致（有测试）。 */
export const ANCHORS: Record<string, [number, number, number]> = {
  "hs-display": [-W + 0.45, 1.6, -1.9],
  "hs-phone": [2.3, 1.3, -D + 0.35],
  "hs-compare": [0.9, 1.3, D - 0.5],
  "hs-plan": [-2.0, 2.05, D - 0.05],
};

export interface Room {
  scene: THREE.Scene;
  /** 热点锚点（世界坐标）。 */
  anchors: Record<string, THREE.Vector3>;
  /** 可点击的物体；userData.hotspotId 指向热点。 */
  pickables: THREE.Object3D[];
}

type Mat = THREE.Material;
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

function mesh(geo: THREE.BufferGeometry, mat: Mat, x = 0, y = 0, z = 0, shadow: "both" | "receive" | "none" = "both") {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow === "both";
  m.receiveShadow = shadow !== "none";
  return m;
}
const box = (w: number, h: number, d: number, mat: Mat, x = 0, y = 0, z = 0, shadow: "both" | "receive" | "none" = "both") => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, shadow);
const rbox = (w: number, h: number, d: number, r: number, mat: Mat, x = 0, y = 0, z = 0) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z);
const screenMat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });

function materials() {
  const wood = T.lightWood();
  return {
    wall: std({ map: T.plaster(), roughness: 0.95, shadowSide: THREE.DoubleSide }),
    floor: std({ map: T.woodFloor(), roughness: 0.5 }),
    ceiling: std({ color: "#f7f6f3", roughness: 1, emissive: "#f4f1ec", emissiveIntensity: 0.32, shadowSide: THREE.DoubleSide }),
    trim: std({ color: "#f7f5f1", roughness: 0.55 }),
    wood: std({ map: wood, roughness: 0.55 }),
    walnut: std({ color: "#6b4a32", roughness: 0.6 }),
    metal: std({ color: "#2c2e33", metalness: 0.6, roughness: 0.4 }),
    alu: std({ color: "#c9ccd1", metalness: 0.85, roughness: 0.3 }),
    aluDark: std({ color: "#8d9198", metalness: 0.85, roughness: 0.35 }),
    device: std({ color: "#1d1f23", metalness: 0.35, roughness: 0.4 }),
    fabric: std({ color: "#8c939b", roughness: 0.95 }),
    linen: std({ color: "#f3efe7", roughness: 1, transparent: true, opacity: 0.92 }),
    leaf: std({ color: "#5d8a55", roughness: 0.75, flatShading: true }),
    pot: std({ color: "#e6e0d6", roughness: 0.7 }),
    rug: std({ map: T.rug(), roughness: 1 }),
    cork: std({ map: T.cork(), roughness: 1 }),
    glow: new THREE.MeshBasicMaterial({ color: "#fff6e6" }),
    shade: std({ color: "#f4ead8", roughness: 0.9, emissive: "#ffdcae", emissiveIntensity: 0.6, side: THREE.DoubleSide }),
  };
}
type M = ReturnType<typeof materials>;

/** 打开的笔记本，默认屏幕朝 +z。 */
function laptop(m: M, tex: THREE.Texture, alu: Mat = m.alu) {
  const g = new THREE.Group();
  g.add(rbox(0.32, 0.014, 0.22, 0.006, alu, 0, 0.007, 0));
  g.add(box(0.27, 0.001, 0.1, m.device, 0, 0.0145, -0.035, "none")); // 键盘区
  g.add(box(0.11, 0.001, 0.065, m.aluDark, 0, 0.0145, 0.065, "none")); // 触控板
  const lid = new THREE.Group();
  lid.position.set(0, 0.014, -0.108);
  lid.rotation.x = -0.27;
  lid.add(rbox(0.32, 0.215, 0.007, 0.004, alu, 0, 0.1075, 0));
  lid.add(box(0.312, 0.205, 0.001, m.device, 0, 0.1075, 0.0036, "none"));
  lid.add(mesh(new THREE.PlaneGeometry(0.296, 0.185), screenMat(tex), 0, 0.111, 0.0042, "none"));
  g.add(lid);
  return g;
}

/** 外接显示器，默认屏幕朝 +z。 */
function monitor(m: M, tex: THREE.Texture) {
  const g = new THREE.Group();
  g.add(box(0.26, 0.012, 0.18, m.metal, 0, 0.006, 0));
  g.add(box(0.05, 0.3, 0.025, m.metal, 0, 0.16, -0.04));
  g.add(rbox(0.66, 0.39, 0.03, 0.008, m.device, 0, 0.42, -0.01));
  g.add(mesh(new THREE.PlaneGeometry(0.64, 0.36), screenMat(tex), 0, 0.425, 0.0055, "none"));
  return g;
}

function phone(m: M, tex: THREE.Texture) {
  const g = new THREE.Group();
  g.add(rbox(0.076, 0.009, 0.162, 0.008, m.device, 0, 0.0045, 0));
  const s = mesh(new THREE.PlaneGeometry(0.07, 0.152), screenMat(tex), 0, 0.0095, 0, "none");
  s.rotation.x = -Math.PI / 2;
  g.add(s);
  return g;
}

/** 书桌：桌面 + 金属腿。默认长边沿 x。 */
function desk(m: M, w: number, d: number, top: Mat = m.wood) {
  const g = new THREE.Group();
  g.add(box(w, 0.035, d, top, 0, 0.74, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.04, 0.72, 0.04, m.metal, sx * (w / 2 - 0.05), 0.36, sz * (d / 2 - 0.05)));
  return g;
}

function officeChair(m: M) {
  const g = new THREE.Group();
  g.add(rbox(0.5, 0.08, 0.48, 0.03, m.fabric, 0, 0.47, 0));
  g.add(rbox(0.48, 0.52, 0.06, 0.03, m.fabric, 0, 0.8, 0.23));
  g.add(box(0.04, 0.4, 0.04, m.metal, 0, 0.25, 0));
  for (let i = 0; i < 5; i++) {
    const leg = box(0.3, 0.025, 0.04, m.metal, 0, 0.05, 0);
    leg.rotation.y = (i / 5) * Math.PI * 2;
    leg.translateX(0.15);
    g.add(leg);
  }
  return g;
}

function woodChair(m: M) {
  const g = new THREE.Group();
  g.add(box(0.44, 0.03, 0.42, m.walnut, 0, 0.45, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.03, 0.45, 0.03, m.walnut, sx * 0.19, 0.225, sz * 0.18));
  for (const sx of [-1, 1]) g.add(box(0.03, 0.45, 0.03, m.walnut, sx * 0.19, 0.69, 0.19));
  g.add(box(0.41, 0.12, 0.02, m.walnut, 0, 0.84, 0.19));
  return g;
}

function plant(m: M, height: number, seed: number) {
  const rnd = T.seeded(seed);
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.34, 24), m.pot, 0, 0.17, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.016, height, 6), m.walnut, 0, 0.34 + height / 2, 0));
  const leafGeo = new THREE.SphereGeometry(1, 7, 5);
  for (let i = 0; i < 26; i++) {
    const leaf = mesh(leafGeo, m.leaf);
    const y = 0.5 + rnd() * (height - 0.1);
    const a = rnd() * Math.PI * 2;
    const r = 0.06 + rnd() * 0.16;
    leaf.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    leaf.scale.set(0.11 + rnd() * 0.05, 0.015, 0.075);
    leaf.rotation.set((rnd() - 0.5) * 0.9, -a, (rnd() - 0.2) * 0.8);
    g.add(leaf);
  }
  return g;
}

function bookshelf(m: M) {
  const rnd = T.seeded(21);
  const g = new THREE.Group();
  const w = 1.3;
  const h = 2.0;
  const d = 0.32;
  for (const sx of [-1, 1]) g.add(box(0.025, h, d, m.wood, sx * (w / 2), h / 2, 0));
  g.add(box(w, h, 0.01, m.wood, 0, h / 2, -d / 2));
  const colors = ["#3d5a73", "#b44b3f", "#d8c8a8", "#5d7552", "#2f3136", "#c9a05a", "#e9e4da", "#7b5e8a"];
  for (let i = 0; i < 5; i++) {
    const y = 0.04 + i * 0.47;
    g.add(box(w, 0.025, d, m.wood, 0, y, 0));
    if (i === 4) continue;
    let x = -w / 2 + 0.04;
    const stop = w / 2 - (rnd() > 0.5 ? 0.35 : 0.06);
    while (x < stop) {
      const bw = 0.025 + rnd() * 0.035;
      const bh = 0.22 + rnd() * 0.12;
      const mat = std({ color: colors[Math.floor(rnd() * colors.length)], roughness: 0.8 });
      const b = box(bw, bh, 0.2 + rnd() * 0.06, mat, x + bw / 2, y + 0.0125 + bh / 2, 0.02);
      g.add(b);
      x += bw + 0.003;
    }
    if (rnd() > 0.4) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 16), m.pot, w / 2 - 0.18, y + 0.07, 0));
  }
  return g;
}

function armchair(m: M) {
  const g = new THREE.Group();
  const cloth = std({ color: "#b9a68c", roughness: 0.95 });
  g.add(rbox(0.8, 0.22, 0.78, 0.06, cloth, 0, 0.3, 0));
  g.add(rbox(0.8, 0.6, 0.16, 0.06, cloth, 0, 0.58, 0.31));
  for (const sx of [-1, 1]) g.add(rbox(0.14, 0.42, 0.78, 0.05, cloth, sx * 0.37, 0.42, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.035, 0.2, 0.035, m.walnut, sx * 0.34, 0.1, sz * 0.32));
  return g;
}

function floorLamp(m: M) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24), m.metal, 0, 0.01, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), m.metal, 0, 0.73, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 24, 1, true), m.shade, 0, 1.52, 0, "none"));
  const light = new THREE.PointLight("#ffd6a0", 2.2, 6, 2);
  light.position.set(0, 1.45, 0);
  g.add(light);
  return g;
}

/** 软木板 + 便签 + 图钉，默认朝 +z。 */
function corkboard(m: M) {
  const rnd = T.seeded(17);
  const g = new THREE.Group();
  g.add(box(1.24, 0.84, 0.03, m.walnut, 0, 0, 0));
  g.add(mesh(new THREE.PlaneGeometry(1.16, 0.76), m.cork, 0, 0, 0.0155, "receive"));
  const notes = ["#fff3b0", "#ffd7c9", "#d9f0e3", "#ffffff", "#dbe8ff", "#fff3b0"];
  const pin = std({ color: "#c7000b", roughness: 0.4 });
  notes.forEach((c, i) => {
    const x = -0.4 + (i % 3) * 0.4 + (rnd() - 0.5) * 0.06;
    const y = 0.17 - Math.floor(i / 3) * 0.36 + (rnd() - 0.5) * 0.05;
    const note = mesh(new THREE.PlaneGeometry(0.22, i === 3 ? 0.28 : 0.2), std({ color: c, roughness: 0.9 }), x, y, 0.018, "receive");
    note.rotation.z = (rnd() - 0.5) * 0.12;
    g.add(note);
    const ink = std({ color: "#5a5f68", roughness: 1 });
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.PlaneGeometry(0.14 - k * 0.03, 0.012), ink, x - 0.01, y + 0.04 - k * 0.04, 0.019, "none"));
    g.add(mesh(new THREE.SphereGeometry(0.012, 10, 8), pin, x, y + 0.085, 0.025));
  });
  return g;
}

function frame(m: M, w: number, h: number, colors: [string, string]) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.025, m.metal, 0, 0, 0));
  g.add(mesh(new THREE.PlaneGeometry(w - 0.06, h - 0.06), std({ color: "#f6f2ea", roughness: 1 }), 0, 0, 0.013, "none"));
  g.add(mesh(new THREE.CircleGeometry(Math.min(w, h) * 0.26, 32), std({ color: colors[0], roughness: 1 }), -w * 0.08, h * 0.05, 0.014, "none"));
  g.add(mesh(new THREE.PlaneGeometry(w * 0.5, h * 0.18), std({ color: colors[1], roughness: 1 }), w * 0.1, -h * 0.2, 0.015, "none"));
  return g;
}

function windowWall(m: M) {
  const g = new THREE.Group();
  const [x0, x1, y0, y1] = [-1.3, 1.3, 0.8, 2.4];
  const wall = (w: number, h: number, x: number, y: number) => box(w, h, 0.12, m.wall, x, y, -D - 0.06);
  g.add(wall(W + x0, H, (-W + x0) / 2, H / 2));
  g.add(wall(W - x1, H, (W + x1) / 2, H / 2));
  g.add(wall(x1 - x0, y0, 0, y0 / 2));
  g.add(wall(x1 - x0, H - y1, 0, (H + y1) / 2));
  const outside = mesh(new THREE.PlaneGeometry(6, 3.6), new THREE.MeshBasicMaterial({ map: T.sky(), toneMapped: false }), 0, 1.6, -D - 1.2, "none");
  g.add(outside);
  // 窗框、中梃、窗台
  const fz = -D - 0.02;
  g.add(box(x1 - x0 + 0.1, 0.06, 0.1, m.trim, 0, y1, fz));
  g.add(box(x1 - x0 + 0.1, 0.06, 0.1, m.trim, 0, y0, fz));
  for (const x of [x0, 0, x1]) g.add(box(0.06, y1 - y0, 0.1, m.trim, x, (y0 + y1) / 2, fz));
  g.add(box(x1 - x0, 0.04, 0.08, m.trim, 0, 1.9, fz));
  g.add(box(x1 - x0 + 0.3, 0.03, 0.22, m.trim, 0, y0 - 0.03, -D + 0.05));
  // 纱帘：几条前后错开的竖条，看起来有褶
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const c = box(0.1, 2.5, 0.015, m.linen, side * (1.42 + i * 0.075), 1.3, -D + 0.12 + (i % 2) * 0.04, "receive");
      g.add(c);
    }
  }
  return g;
}

export function buildRoom(): Room {
  const m = materials();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9e6e0");
  const anchors = Object.fromEntries(Object.entries(ANCHORS).map(([id, p]) => [id, new THREE.Vector3(...p)]));
  const pickables: THREE.Object3D[] = [];
  const tag = (o: THREE.Object3D, hotspotId: string) => {
    o.userData.hotspotId = hotspotId;
    pickables.push(o);
    return o;
  };

  // 地面、天花、墙
  const floor = mesh(new THREE.PlaneGeometry(2 * W, 2 * D), m.floor, 0, 0, 0, "receive");
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // 天花板要挡光：太阳比天花板高，不投影的话阳光会照满整个房间
  const ceiling = mesh(new THREE.PlaneGeometry(2 * W, 2 * D), m.ceiling, 0, H, 0);
  ceiling.rotation.x = Math.PI / 2;
  scene.add(ceiling);
  const back = mesh(new THREE.PlaneGeometry(2 * W, H), m.wall, 0, H / 2, D);
  back.rotation.y = Math.PI;
  const left = mesh(new THREE.PlaneGeometry(2 * D, H), m.wall, -W, H / 2, 0);
  left.rotation.y = Math.PI / 2;
  const right = mesh(new THREE.PlaneGeometry(2 * D, H), m.wall, W, H / 2, 0);
  right.rotation.y = -Math.PI / 2;
  scene.add(back, left, right, windowWall(m));
  // 踢脚线
  scene.add(box(2 * W, 0.08, 0.015, m.trim, 0, 0.04, D - 0.008), box(0.015, 0.08, 2 * D, m.trim, -W + 0.008, 0.04, 0), box(0.015, 0.08, 2 * D, m.trim, W - 0.008, 0.04, 0));
  scene.add(box(W - 1.45, 0.08, 0.015, m.trim, -(W + 1.45) / 2, 0.04, -D + 0.008), box(W - 1.45, 0.08, 0.015, m.trim, (W + 1.45) / 2, 0.04, -D + 0.008));
  // 筒灯
  for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) {
    const disc = mesh(new THREE.CircleGeometry(0.07, 24), m.glow, x, H - 0.002, z, "none");
    disc.rotation.x = Math.PI / 2;
    scene.add(disc);
  }

  const rugMesh = mesh(new THREE.PlaneGeometry(3.0, 2.1), m.rug, 0.2, 0.004, 0.3, "receive");
  rugMesh.rotation.x = -Math.PI / 2;
  scene.add(rugMesh);

  // 左墙书桌：笔记本 + 外接显示器（多屏协同）
  const studio = new THREE.Group();
  studio.position.set(-W + 0.38, 0, -1.9);
  studio.rotation.y = Math.PI / 2; // 桌子长边沿 z，设备朝 +x（房间中央）
  studio.add(desk(m, 1.5, 0.7));
  const mon = monitor(m, T.screen("desktop", 4));
  mon.position.set(0.15, 0.757, -0.15);
  studio.add(mon);
  const lap1 = laptop(m, T.screen("doc", 5));
  lap1.position.set(-0.47, 0.757, 0.04);
  lap1.rotation.y = -0.35;
  studio.add(lap1);
  studio.add(mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 16), m.pot, 0.62, 0.807, -0.22));
  const chair1 = officeChair(m);
  chair1.position.set(0.6, 0, 0.55);
  chair1.rotation.y = 0.25;
  studio.add(chair1);
  scene.add(tag(studio, "hs-display"));
  const art1 = frame(m, 0.62, 0.46, ["#d98c5f", "#3d5a73"]);
  art1.position.set(-W + 0.02, 1.9, -1.75);
  art1.rotation.y = Math.PI / 2;
  scene.add(art1);

  // 窗边小桌：笔记本 + 手机（文件互传）
  const nook = new THREE.Group();
  nook.position.set(2.35, 0, -D + 0.32);
  nook.add(desk(m, 1.3, 0.58, m.walnut));
  const lap2 = laptop(m, T.screen("desktop", 8), m.aluDark);
  lap2.position.set(-0.15, 0.757, -0.02);
  lap2.rotation.y = -0.12;
  nook.add(lap2);
  // 手机立在小支架上、屏幕朝向房间，从远处也认得出来
  const ph = phone(m, T.screen("phone", 9));
  ph.position.set(0.36, 0.84, 0.06);
  ph.rotation.set(1.22, -0.3, 0, "YXZ");
  nook.add(ph);
  nook.add(box(0.06, 0.05, 0.05, m.metal, 0.37, 0.782, 0.02));
  nook.add(mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), std({ color: "#f2efe9", roughness: 0.5 }), 0.52, 0.807, -0.12));
  const chair2 = woodChair(m);
  chair2.position.set(-0.05, 0, 0.6);
  chair2.rotation.y = 0.15;
  nook.add(chair2);
  scene.add(tag(nook, "hs-phone"));

  // 后方长桌：三台候选笔记本（候选比较）
  const bench = new THREE.Group();
  bench.position.set(0.9, 0, D - 0.42);
  bench.rotation.y = Math.PI;
  bench.add(desk(m, 1.9, 0.7));
  [-0.6, 0, 0.6].forEach((x, i) => {
    const l = laptop(m, T.screen("compare", 20 + i), i === 1 ? m.aluDark : m.alu);
    l.position.set(x, 0.757, 0.05);
    bench.add(l);
    bench.add(box(0.12, 0.002, 0.07, m.trim, x, 0.758, 0.27, "none")); // 价签位
  });
  scene.add(tag(bench, "hs-compare"));
  [[0.45, ["#c9a05a", "#5d7552"]], [1.3, ["#7b5e8a", "#d8c8a8"]]].forEach(([x, c]) => {
    const f = frame(m, 0.5, 0.62, c as [string, string]);
    f.position.set(x as number, 1.75, D - 0.015);
    f.rotation.y = Math.PI;
    scene.add(f);
  });

  // 软木板（我的方案）
  const board = corkboard(m);
  board.position.set(-2.0, 1.5, D - 0.02);
  board.rotation.y = Math.PI;
  scene.add(tag(board, "hs-plan"));

  // 陈设
  const shelf = bookshelf(m);
  shelf.position.set(W - 0.17, 0, 0.5);
  shelf.rotation.y = -Math.PI / 2;
  scene.add(shelf);
  const chair3 = armchair(m);
  chair3.position.set(2.75, 0, 2.45);
  chair3.rotation.y = Math.PI + 0.7;
  scene.add(chair3);
  const lamp = floorLamp(m);
  lamp.position.set(3.25, 0, 2.95);
  scene.add(lamp);
  const p1 = plant(m, 1.3, 31);
  p1.position.set(-W + 0.3, 0, -D + 0.35);
  scene.add(p1);
  const p2 = plant(m, 0.8, 37);
  p2.position.set(-0.6, 0, D - 0.35);
  scene.add(p2);

  // 光：窗外阳光（投影，穿过窗洞落在地上）+ 天空漫射 + 两盏室内灯
  scene.add(new THREE.HemisphereLight("#f2f5ff", "#d9cfc1", 0.95));
  // 午后偏高的太阳：光斑落在窗前地板上，正对窗户时就能看到
  const sun = new THREE.DirectionalLight("#ffeccc", 4.2);
  // 阴影相机以房间中心为准、覆盖整个房间；覆盖不到的地方会“漏光”（墙角出现亮斜块）
  sun.position.set(-2.1, 8.2, -5.25);
  sun.target.position.set(0, 1.2, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 1, far: 20 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  for (const [x, z] of [[-1.5, 0], [1.5, 1.2]] as const) {
    const l = new THREE.PointLight("#fff1de", 3.2, 7, 2);
    l.position.set(x, H - 0.25, z);
    scene.add(l);
  }

  return { scene, anchors, pickables };
}

/** 世界坐标 → 从站位看过去的水平角 / 俯仰角（度）。用于让热点的 yaw/pitch 与三维位置一致。 */
export function yawPitchOf(p: THREE.Vector3): { yaw: number; pitch: number } {
  const d = p.clone().sub(EYE);
  return { yaw: (Math.atan2(d.x, -d.z) * 180) / Math.PI, pitch: (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI };
}
