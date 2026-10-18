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

/** 面板标题：标题 + 可选副标题 + 右侧补充信息。id 供 section 的 aria-labelledby 引用。 */
export function PanelHead({ id, title, description, aside }: { id: string; title: string; description?: string; aside?: ReactNode }) {
  return (
    <header className="panel-head">
      <div>
        <h2 id={id} className="panel-title">{title}</h2>
        {description && <p className="panel-desc">{description}</p>}
      </div>
      {aside && <div className="panel-aside">{aside}</div>}
    </header>
  );
}
