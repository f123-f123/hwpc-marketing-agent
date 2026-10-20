/**
 * 体验空间的渲染器：按需渲染（只在视角或尺寸变化时画一帧），不跑常驻动画循环。
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EYE, buildRoom } from "./build";

const DEG = Math.PI / 180;
export const FOV_V = 62;

export interface Placement {
  left: number;
  top: number;
}

export interface RoomEngine {
  canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  setView(yaw: number, pitch: number): void;
  /** 当前水平视角（度），用于把拖动距离换算成转角。 */
  hfov(): number;
  /** 热点锚点在画面上的位置（百分比）；在身后或画面外时为 null。 */
  place(hotspotId: string, fallback: { yaw: number; pitch: number }): Placement | null;
  /** 点到了哪个热点的物体。 */
  pick(clientX: number, clientY: number): string | null;
  dispose(): void;
}

export function createRoomEngine(): RoomEngine {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const { scene, anchors, pickables } = buildRoom();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(FOV_V, 2, 0.05, 30);
  camera.position.copy(EYE);
  camera.rotation.order = "YXZ";

  const raycaster = new THREE.Raycaster();
  const tmp = new THREE.Vector3();
  let frame = 0;
  const render = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  };
  const sync = () => {
    camera.updateMatrixWorld();
    render();
  };

  return {
    canvas: renderer.domElement,
    resize(width, height) {
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      sync();
    },
    setView(yaw, pitch) {
      camera.rotation.set(pitch * DEG, -yaw * DEG, 0);
      sync();
    },
    hfov() {
      return (2 * Math.atan(Math.tan((FOV_V * DEG) / 2) * camera.aspect)) / DEG;
    },
    place(hotspotId, fallback) {
      const anchor = anchors[hotspotId];
      if (anchor) tmp.copy(anchor);
      else {
        // 没有对应陈设的热点：按 yaw/pitch 放在 3 m 外
        const y = fallback.yaw * DEG;
        const p = fallback.pitch * DEG;
        tmp.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)).multiplyScalar(3).add(EYE);
      }
      const inCam = tmp.clone().applyMatrix4(camera.matrixWorldInverse);
      if (inCam.z > -0.1) return null;
      tmp.project(camera);
      const left = ((tmp.x + 1) / 2) * 100;
      const top = ((1 - tmp.y) / 2) * 100;
      if (left < 6 || left > 94 || top < 4 || top > 96) return null;
      return { left, top };
    },
    pick(clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(pickables, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.hotspotId) o = o.parent;
      return (o?.userData.hotspotId as string | undefined) ?? null;
    },
    dispose() {
      cancelAnimationFrame(frame);
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const mat of [o.material].flat() as THREE.Material[]) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
