import { useId, type ReactNode, type Ref } from "react";
import type { InstanceView } from "@hwpc/contracts";
import { Icon } from "../../components/ui";
import type { PhotoArt } from "../flows/fileTransfer";

/** 每个场景渲染器的统一入参：冻结的实例视图 + 是否可操作 + 提交服务端动作。 */
export interface StageProps {
  view: InstanceView;
  disabled: boolean;
  onAction: (actionId: string) => void;
}

/**
 * 虚拟设备外壳：不带品牌标识的示意笔记本、手机、显示器。
 * 尺寸用容器查询单位（cqw），整个桌面按面板宽度等比缩放；屏幕里的内容由各场景自己画。
 */
export function Laptop({ label, children, screenRef, tone = "silver" }: { label: string; children: ReactNode; screenRef?: Ref<HTMLDivElement>; tone?: "silver" | "graphite" }) {
  return (
    <figure className={`dev dev-laptop dev-${tone}`} aria-label={label}>
      <div className="dev-lid">
        <div className="dev-cam" aria-hidden="true" />
        <div className="dev-screen" ref={screenRef}>{children}</div>
      </div>
      <div className="dev-base" aria-hidden="true"><span className="dev-notch" /></div>
      <figcaption className="dev-label">{label}</figcaption>
    </figure>
  );
}

export function Phone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="dev dev-phone" aria-label={label}>
      <div className="dev-phone-body">
        <div className="dev-screen dev-phone-screen">
          <span className="dev-punch" aria-hidden="true" />
          {children}
        </div>
      </div>
      <figcaption className="dev-label">{label}</figcaption>
    </figure>
  );
}

export function Monitor({ label, children, screenRef, below }: { label: string; children: ReactNode; screenRef?: Ref<HTMLDivElement>; below?: ReactNode }) {
  return (
    <figure className="dev dev-monitor" aria-label={label}>
      <div className="dev-mon-panel">
        <div className="dev-screen" ref={screenRef}>{children}</div>
      </div>
      <div className="dev-mon-neck" aria-hidden="true" />
      <div className="dev-mon-foot" aria-hidden="true" />
      <figcaption className="dev-label">{label}{below}</figcaption>
    </figure>
  );
}

/** 电脑任务栏（通用示意）。 */
export function Taskbar({ children, time = "17:24" }: { children?: ReactNode; time?: string }) {
  return (
    <div className="os-taskbar">
      <span className="os-tb-start" aria-hidden="true"><Icon name="ring" size={14} /></span>
      <span className="os-tb-search" aria-hidden="true"><Icon name="search" size={12} />搜索</span>
      <span className="os-tb-spacer" />
      <span className="os-tb-tray">
        {children}
        <Icon name="wifi" size={13} />
        <span className="os-tb-time">{time}</span>
      </span>
    </div>
  );
}

const ART: Record<PhotoArt, { sky: [string, string]; layers: { d: string; fill: string }[]; sun?: [number, number, string] }> = {
  harbor: {
    sky: ["#f6b37f", "#7f6fa8"],
    sun: [88, 38, "#ffe2b0"],
    layers: [
      { d: "M0 58 L18 50 L30 54 L46 44 L60 52 L78 47 L96 53 L120 46 V90 H0Z", fill: "#56507a" },
      { d: "M0 64 H120 V90 H0Z", fill: "#3f5b82" },
      { d: "M14 66 h22 l-4 5 h-14z M70 70 h16 l-3 4 h-10z", fill: "#262a40" },
    ],
  },
  lake: {
    sky: ["#bfe0f5", "#e9f3f7"],
    layers: [
      { d: "M0 52 L22 24 L36 40 L52 18 L74 46 L92 30 L120 50 V90 H0Z", fill: "#6c8aa3" },
      { d: "M0 56 L30 44 L60 54 L90 42 L120 56 V90 H0Z", fill: "#4f7a5d" },
      { d: "M0 62 H120 V90 H0Z", fill: "#7fb3c9" },
    ],
  },
  city: {
    sky: ["#1d2547", "#4b3d6e"],
    layers: [
      { d: "M0 90 V54 h12 V40 h10 V58 h8 V30 h14 V50 h10 V36 h12 V60 h8 V44 h16 V56 h12 V38 h18 V90Z", fill: "#14182c" },
      { d: "M16 46h3v3h-3zM34 36h3v3h-3zM34 44h3v3h-3zM58 42h3v3h-3zM86 48h3v3h-3zM104 44h3v3h-3zM104 52h3v3h-3z", fill: "#f4c96a" },
    ],
  },
  field: {
    sky: ["#9fd0f0", "#fdf3d9"],
    sun: [26, 22, "#fff4c8"],
    layers: [
      { d: "M0 50 Q30 40 60 48 T120 44 V90 H0Z", fill: "#8fbf6a" },
      { d: "M0 62 Q40 52 80 62 T120 58 V90 H0Z", fill: "#e8c14f" },
      { d: "M0 74 Q50 66 120 74 V90 H0Z", fill: "#d99a3a" },
    ],
  },
  desk: {
    sky: ["#efe6da", "#d9cbb8"],
    layers: [
      { d: "M0 60 H120 V90 H0Z", fill: "#a77d55" },
      { d: "M30 30 h40 v26 h-40z", fill: "#2a2d33" },
      { d: "M33 33 h34 v20 h-34z", fill: "#8fb0d6" },
      { d: "M80 46 a8 8 0 1 0 16 0 v10 h-16z", fill: "#f4f1ea" },
      { d: "M24 56 h52 v4 h-52z", fill: "#c4c7cc" },
    ],
  },
  snow: {
    sky: ["#d6e4f2", "#f4f7fa"],
    layers: [
      { d: "M0 56 L28 22 L44 40 L62 14 L88 44 L104 32 L120 46 V90 H0Z", fill: "#a9bccf" },
      { d: "M22 30 L28 22 L34 30Z M56 22 L62 14 L68 22Z", fill: "#ffffff" },
      { d: "M0 66 Q60 56 120 66 V90 H0Z", fill: "#f3f6f9" },
    ],
  },
};

/** 示意照片：程序画的风景小图，不是真实照片，也不是产品图。 */
export function PhotoArtView({ art, className }: { art: PhotoArt; className?: string }) {
  const id = useId();
  const a = ART[art];
  return (
    <svg className={className ?? "photo"} viewBox="0 0 120 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={a.sky[0]} />
          <stop offset="1" stopColor={a.sky[1]} />
        </linearGradient>
      </defs>
      <rect width="120" height="90" fill={`url(#${id}-s)`} />
      {a.sun && <circle cx={a.sun[0]} cy={a.sun[1]} r="9" fill={a.sun[2]} />}
      {a.layers.map((l, i) => <path key={i} d={l.d} fill={l.fill} />)}
    </svg>
  );
}

/** 当前该做什么：步骤条 + 一句话指引 + 为什么。 */
export function StageCoach({ steps, step, text, detail }: { steps: string[]; step: number; text: string; detail?: string }) {
  const done = step >= steps.length;
  return (
    <div className={`coach${done ? " is-done" : ""}`} role="status" aria-live="polite">
      <ol className="coach-steps" aria-label="步骤">
        {steps.map((s, i) => (
          <li key={s} className={i < step ? "is-done" : i === step ? "is-current" : undefined} aria-current={i === step ? "step" : undefined}>
            <span className="coach-dot" aria-hidden="true">{i < step ? <Icon name="check" size={11} /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="coach-text">{done ? <Icon name="check" /> : <span className="coach-num">第 {step + 1} 步</span>}{text}</p>
      {detail && <p className="coach-detail">{detail}</p>}
    </div>
  );
}
