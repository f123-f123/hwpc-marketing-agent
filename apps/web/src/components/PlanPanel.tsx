import type { SessionSnapshot } from "@hwpc/contracts";
import { api } from "../api/client";
import { CAPABILITY_LABEL, COMPLETION_LABEL, FEEDBACK_KIND_LABEL } from "../lib/labels";
import { Alert, Badge, EmptyState, Icon, PanelHead } from "./ui";

const PLAN_STATUS_LABEL: Record<string, string> = { current: "当前", superseded: "已取代", stale: "已过期" };

export function PlanPanel({ snap, busy, onCompose, onConfirmTab, onOpenInstance }: {
  snap: SessionSnapshot;
  busy: boolean;
  onCompose: () => void;
  onConfirmTab: () => void;
  onOpenInstance: (instanceId: string) => void;
}) {
  const plan = snap.plan.current;
  const records = snap.feedback.length + snap.impacts.length;

  const history = (
    <details className="fold">
      <summary>反馈与方案更新记录 <span className="muted">{records} 条</span></summary>
      <div className="fold-grid">
        <div>
          <h4>你的明确反馈</h4>
          {snap.feedback.length ? (
            <ul className="log">{snap.feedback.map((f) => <li key={f.feedbackId}><Badge>{FEEDBACK_KIND_LABEL[f.kind]}</Badge> {f.text}</li>)}</ul>
          ) : <p className="muted small">还没有反馈。在场景里提交的反馈会出现在这里。</p>}
        </div>
        <div>
          <h4>影响分析</h4>
          {snap.impacts.length ? <ul className="log">{snap.impacts.map((i) => <li key={i.impactId}>{i.summary}</li>)}</ul> : <p className="muted small">还没有记录。</p>}
        </div>
      </div>
      {snap.plan.versions.length > 1 && (
        <>
          <h4>方案版本</h4>
          <ul className="log">
            {snap.plan.versions.map((v) => <li key={v.version}>v{v.version} · 基于需求 v{v.needVersion} · {PLAN_STATUS_LABEL[v.status] ?? v.status} · {new Date(v.createdAt).toLocaleString()}</li>)}
          </ul>
        </>
      )}
    </details>
  );

  const capabilities = (
    <details className="fold">
      <summary>保存方式与服务说明</summary>
      <p className="small muted">会话保存在本机服务端；本浏览器只记住会话编号和全景朝向。</p>
      <ul className="log">
        {snap.capabilities.declarations.map((d) => (
          <li key={d.id}>
            <strong>{CAPABILITY_LABEL[d.id] ?? d.id}</strong>
            {d.status !== "supported" && <Badge tone="warning">{d.status === "unsupported" ? "不支持" : "有条件"}</Badge>}
            ：{d.statement}
          </li>
        ))}
      </ul>
    </details>
  );

  if (!plan) {
    const confirmed = snap.needs.status === "confirmed";
    return (
      <section className="panel" aria-labelledby="plan-title">
        <PanelHead id="plan-title" title="个人方案" description="需求确认后生成，记录推荐理由、取舍和要体验的场景。" />
        <EmptyState
          title="还没有个人方案"
          action={
            confirmed
              ? <button type="button" className="btn btn-primary" disabled={busy || !snap.plan.canCompose} onClick={onCompose}>生成个人方案</button>
              : <button type="button" className="btn" onClick={onConfirmTab}>去确认需求</button>
          }
        >
          {confirmed ? (snap.plan.canCompose ? "需求已确认，可以生成方案了。" : snap.plan.cannotComposeReason) : "先确认需求摘要，再生成方案。"}
        </EmptyState>
        {snap.plan.versions.some((v) => v.status === "stale") && <Alert>之前的方案因需求变化已过期，确认新需求后可以重新生成。</Alert>}
        {history}
        {capabilities}
      </section>
    );
  }

  const nameOf = (candidateId: string) => plan.candidates.find((c) => c.candidateId === candidateId)?.modelName ?? candidateId;
  const primary = plan.recommendation.byCandidate.find((r) => r.role === "recommended");
  const others = plan.recommendation.byCandidate.filter((r) => r.role !== "recommended");
  const failed = plan.verification.checks.filter((c) => !c.ok);

  return (
    <section className="panel" aria-labelledby="plan-title">
      <PanelHead
        id="plan-title"
        title={`个人方案 v${plan.version}`}
        description={`基于需求 v${plan.needVersion} 的确认 · ${new Date(plan.createdAt).toLocaleString()}`}
        aside={
          <div className="row">
            <Badge tone={plan.verification.ok ? "success" : "warning"}>{plan.verification.ok ? "核验通过" : "核验未通过"}</Badge>
            {plan.needsReview && <Badge tone="warning">待复核</Badge>}
            {plan.isMock && <Badge tone="warning">含模拟内容</Badge>}
          </div>
        }
      />

      {failed.length > 0 && <Alert tone="warning"><strong>核验未通过：</strong>{failed.map((c) => c.detail).join("；")}</Alert>}
      {plan.needsReview && <Alert tone="warning">你提交了新的反馈，方案需要复核。确认后可以按当前需求重新生成。</Alert>}

      <div className="reco">
        {primary ? (
          <>
            <p className="reco-label">首选</p>
            <p className="reco-name">{nameOf(primary.candidateId)}</p>
            <p className="reco-reason">{primary.reason}</p>
          </>
        ) : (
          <>
            <p className="reco-label">暂不推荐</p>
            <p className="reco-reason">{plan.recommendation.noRecommendationReason ?? "现有资料不足以给出首选。"}</p>
          </>
        )}
        {others.length > 0 && (
          <ul className="reco-others">
            {others.map((r) => <li key={r.candidateId}><strong>{nameOf(r.candidateId)}</strong>{r.role === "alternative" ? "（备选）" : "（不推荐）"}：{r.reason}</li>)}
          </ul>
        )}
      </div>

      <h3 className="subhead">安排的场景体验</h3>
      {plan.scenes.length > 0 ? (
        <ol className="plan-scenes">
          {plan.scenes.map((e) => {
            const v = snap.scenes.instances.find((x) => x.instance.instanceId === e.instanceId);
            const completion = v?.experience.completion ?? "not_started";
            return (
              <li key={e.instanceId}>
                <div>
                  <strong>{v?.title ?? e.sceneId}</strong>
                  <p className="muted small">{e.reason}</p>
                </div>
                <div className="row">
                  <Badge tone={completion === "walkthrough_completed" ? "success" : "neutral"}>{COMPLETION_LABEL[completion]}</Badge>
                  <button type="button" className="btn btn-sm" disabled={!v} onClick={() => onOpenInstance(e.instanceId)}>打开任务</button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="muted small">这次没有可纳入的场景：缺少设备证据时会跳过，而不是硬凑。</p>}

      {snap.plan.notes.length > 0 && (
        <Alert>
          <strong>没有纳入的场景：</strong>
          <ul>{snap.plan.notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul>
        </Alert>
      )}

      <div className="export">
        <div>
          <strong>保留这份方案</strong>
          <p className="muted small">导出只读快照（HTML，含完整性校验）。互动体验仍需要连接当前服务。</p>
        </div>
        <a className="btn btn-primary" href={api.exportUrl(snap)} target="_blank" rel="noopener">导出只读方案<Icon name="external" /></a>
      </div>

      {history}
      {capabilities}
    </section>
  );
}
