import type { ReactNode } from "react";

/** 线性图标（24 网格、1.75 描边）。不用 emoji / Unicode 符号，避免不同字体下显示不一致。 */
const PATHS = {
  display: "M3 5h18v11H3zM8 20h8M12 16v4",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2",
  compare: "M7 4v16M17 4v16M3 8h8M13 16h8",
  plan: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  back: "M15 5l-7 7 7 7",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  plus: "M12 5v14M5 12h14",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  alert: "M12 3l9.5 17h-19zM12 10v4M12 17.2v.3",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
  // 以下用于场景里的虚拟设备界面（通用示意图形，不是任何系统的官方图标）
  wifi: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
  cast: "M3 8V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6M3 12a7 7 0 0 1 7 7M3 16a3 3 0 0 1 3 3",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  close: "M6 6l12 12M18 6L6 18",
  laptop: "M5 6h14v9H5zM3 18h18",
  camera: "M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1",
  calendar: "M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4",
  note: "M6 3h9l4 4v14H6zM9 11h7M9 15h7",
  music: "M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  message: "M4 5h16v11H9l-5 4z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M15.5 15.5L20 20",
  ring: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  doc: "M6 3h9l4 4v14H6zM14.5 3v4.5H19M9 12h6M9 16h6",
  signal: "M5 19v-3M10 19v-7M15 19V8M20 19V4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.5M12 7.8v.2",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.5V12l3 2",
  bag: "M6 8h12l1 12.5H5zM9 8V6a3 3 0 0 1 6 0v2",
  plug: "M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21",
  bolt: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  train: "M7 3.5h10a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2zM5 10h14M8.5 13.5h.01M15.5 13.5h.01M8 17l-2 3.5M16 17l2 3.5",
  car: "M5 16.5h14M3.5 16.5V12l2-5h13l2 5v4.5M3.5 12h17M7 16.5V19M17 16.5V19M7.5 14h.01M16.5 14h.01",
  coffee: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5",
  home: "M4 11l8-7 8 7M6 9.5V20h12V9.5",
  slides: "M3 4.5h18v12H3zM12 16.5V20M8 20h8M7 9h6M7 12h10",
  mouse: "M12 3a6 6 0 0 1 6 6v6a6 6 0 0 1-12 0V9a6 6 0 0 1 6-6zM12 3v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone === "neutral" ? "badge" : `badge badge-${tone}`}>{children}</span>;
}

export function Alert({ tone = "neutral", children, action }: { tone?: "neutral" | "warning" | "danger" | "success"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={tone === "neutral" ? "alert" : `alert alert-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
