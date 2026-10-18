import { NEED_KEY_LABEL, type SessionSnapshot } from "@hwpc/contracts";
import { ENTRY_STATUS_LABEL, NEEDS_STATUS_LABEL } from "../lib/labels";
import { Alert, Badge, EmptyState, PanelHead } from "./ui";

/** 确认按钮只放在顶部“下一步”里，这里只解释确认的含义，避免同一屏两个相同主按钮。 */
export function NeedsPanel({ snap, busy, onCompose }: {
  snap: SessionSnapshot;
  busy: boolean;
  onCompose: () => void;
}) {
  const { needs, plan } = snap;
  const filled = needs.summary.groups.filter((g) => g.entries.length > 0);
  const missing = needs.summary.groups.filter((g) => g.entries.length === 0);
  const confirmed = needs.status === "confirmed";

  return (
    <section className="panel" aria-labelledby="needs-title">
      <PanelHead
        id="needs-title"
        title="需求摘要"
        description="顾问从对话里整理出的要点。标着“推断”“默认”的条目请特别核对。"
        aside={<Badge tone={confirmed ? "success" : needs.status === "collecting" ? "neutral" : "warning"}>v{needs.version} · {NEEDS_STATUS_LABEL[needs.status]}</Badge>}
      />

      {filled.length === 0 ? (
        <EmptyState title="还没有整理出需求">在左侧告诉顾问你的主要任务、预算和已有设备。</EmptyState>
      ) : (
        <dl className="needs">
          {filled.map((g) => (
            <div className="needs-row" key={g.key}>
              <dt>{NEED_KEY_LABEL[g.key]}</dt>
              <dd>
                <ul>
                  {g.entries.map((e) => (
                    <li key={e.entryId}>
                      <span>{e.value}</span>
                      {e.hard && <Badge tone="primary">硬条件</Badge>}
                      {e.status !== "known" && <Badge tone={e.status === "pending" ? "warning" : "neutral"}>{ENTRY_STATUS_LABEL[e.status]}</Badge>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {missing.length > 0 && filled.length > 0 && (
        <p className="muted small needs-missing">还可以补充：{missing.map((g) => NEED_KEY_LABEL[g.key]).join("、")}。不说也没关系。</p>
      )}

      <div className="stack">
        {needs.summary.assumptions.length > 0 && (
          <Alert tone="warning">
            <strong>请核对这些推断：</strong>
            <ul>{needs.summary.assumptions.map((a) => <li key={a.entryId}>{a.text}</li>)}</ul>
          </Alert>
        )}
        {needs.summary.blockers.length > 0 && <Alert tone="warning"><strong>暂时不能确认：</strong>{needs.summary.blockers.join("；")}</Alert>}
        {needs.invalidatedConfirmations.length > 0 && !confirmed && (
          <Alert>之前的 {needs.invalidatedConfirmations.length} 次确认因需求变化已失效，需要重新确认。</Alert>
        )}
      </div>

      <footer className="panel-foot">
        {confirmed ? (
          <>
            <p className="muted small">已于 {needs.confirmation ? new Date(needs.confirmation.confirmedAt).toLocaleString() : "此前"} 确认。之后的关键变化会要求重新确认。</p>
            {plan.current && (
              <button type="button" className="btn" disabled={busy || !plan.canCompose} title={plan.cannotComposeReason} onClick={onCompose}>
                按当前需求重新生成方案
              </button>
            )}
          </>
        ) : (
          <p className="muted small">确认的是你看到的这一版（v{needs.version}），只能用上方的确认按钮；在聊天里说“确认”不算数。</p>
        )}
      </footer>
    </section>
  );
}
