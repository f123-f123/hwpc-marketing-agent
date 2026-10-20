import type { VerificationReport } from "@hwpc/contracts";
import { Badge } from "../ui";
import { DELIVERY_LABEL, DELIVERY_TONE, RESOLUTION_LABEL } from "./labels";

const KIND: Record<string, string> = { fact: "事实", image: "图片", compliance: "合规", conflict: "资料冲突", style: "风格" };

/** 核验结果：先列需要注意的问题，通过项折叠起来（说明“查过什么”）。 */
export function VerifyReport({ report }: { report: VerificationReport }) {
  const issues = report.findings.filter((f) => f.resolution !== "passed");
  const passed = report.findings.filter((f) => f.resolution === "passed");
  return (
    <section className="verify" aria-label="核验结果">
      <header className="row">
        <Badge tone={DELIVERY_TONE[report.deliveryStatus] ?? "neutral"}>{DELIVERY_LABEL[report.deliveryStatus] ?? report.deliveryStatus}</Badge>
        <span className="muted small">{issues.length ? `${issues.length} 条需要了解` : "没有需要处理的问题"} · {passed.length} 项检查通过</span>
      </header>
      {issues.length > 0 && (
        <ul className="verify-list">
          {issues.map((f) => (
            <li key={f.findingId} className={`sev-${f.severity}`}>
              <span className="row">
                <Badge tone={f.severity === "blocker" ? "danger" : f.severity === "major" ? "warning" : "neutral"}>{KIND[f.kind] ?? f.kind} · {RESOLUTION_LABEL[f.resolution]}</Badge>
              </span>
              <p>{f.message}</p>
              {f.excerpt && <blockquote>{f.excerpt}</blockquote>}
            </li>
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <details>
          <summary className="small muted">查看通过的检查</summary>
          <ul className="verify-passed small muted">{passed.map((f) => <li key={f.findingId}>{f.message}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
