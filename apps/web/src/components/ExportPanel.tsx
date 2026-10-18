import { useState } from "react";
import type { AdvisorClient } from "../advisor/client";
import { buildInteractiveHtml, buildPlatformCopy, buildReportMarkdown, downloadText, imageToDataUri, statusNotice } from "../advisor/exporters";
import type { WorkView } from "../advisor/types";

interface Props {
  work: WorkView;
  client: AdvisorClient;
  sessionId: string;
}

export function ExportPanel({ work, client, sessionId }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const notices = statusNotice(work);
  const copy = buildPlatformCopy(work);
  const rv = work.result;
  const ds = rv.verification.deliveryStatus;
  const publishBlocked = ds === "blocked" || ds === "needs_confirmation" || !work.meta.currentRequirement;

  const ok = (m: string) => (setErr(null), setMsg(m));
  const bad = (m: string) => (setMsg(null), setErr(m));

  const doReport = () => {
    const r = buildReportMarkdown(work);
    downloadText(r.filename, r.content, "text/markdown");
    ok(`已导出 ${r.filename}`);
  };
  const doCopyText = async () => {
    try {
      await navigator.clipboard.writeText(copy.content);
      ok(copy.warnings.length ? "已复制发布正文。注意：开头的状态说明已一并复制，发布前需处理。" : "已复制发布正文（含事实限制说明）。");
    } catch {
      bad("浏览器不允许写入剪贴板，请改用“下载正文”。");
    }
  };
  const doDownloadText = () => {
    downloadText(copy.filename, copy.content);
    ok(`已导出 ${copy.filename}`);
  };
  const doHtml = async () => {
    setWorking(true);
    try {
      const ids = new Set<string>();
      const plan = work.interactive!;
      plan.scenes.forEach((s) => s.items.forEach((i) => i.imageId && ids.add(i.imageId)));
      plan.claims.forEach((c) => c.imageIds.forEach((i) => ids.add(i)));
      const data: Record<string, string> = {};
      const failed: string[] = [];
      for (const id of ids) {
        const url = client.imageUrl(sessionId, work.version, id);
        if (!url) {
          failed.push(id);
          continue;
        }
        try {
          data[id] = await imageToDataUri(url);
        } catch {
          failed.push(id);
        }
      }
      const r = buildInteractiveHtml(work, data);
      downloadText(r.filename, r.content, "text/html");
      const parts = [`已导出 ${r.filename}（图片内嵌 ${r.imageCount} 张，无需联网或本地接口即可打开）`];
      if (failed.length || r.missingImages.length) parts.push(`有 ${new Set([...failed, ...r.missingImages]).size} 张图片未能内嵌，文件中已标明“图片暂不可用”`);
      if (r.skippedStates.length) parts.push(`${r.skippedStates.length} 个未核验状态未写入`);
      ok(parts.join("；"));
    } catch (e) {
      bad(e instanceof Error ? e.message : "导出失败");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="export" role="tabpanel">
      {notices.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>导出会保留这些状态说明，不会被隐藏：</strong>
          <ul>{notices.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      <div className="export-grid">
        <div className="card flat">
          <h3>1. 完整报告（赛题四部分）</h3>
          <p className="muted small">场景判断 · 知识库依据 · 图文软文 · 核验结果。Markdown 文件。</p>
          <button type="button" className="btn primary" onClick={doReport}>下载报告</button>
        </div>

        <div className="card flat">
          <h3>2. 平台发布正文</h3>
          <p className="muted small">纯文本，保留每段的事实限制说明。{publishBlocked ? "当前状态不应直接发布，复制内容开头已带状态说明。" : ""}</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={doCopyText}>复制正文</button>
            <button type="button" className="btn" onClick={doDownloadText}>下载正文</button>
          </div>
        </div>

        <div className="card flat">
          <h3>3. 互动网页（单个 HTML 文件）</h3>
          {work.interactive ? (
            <>
              <p className="muted small">
                自包含：样式、少量固定脚本和图片都在文件里，不依赖本地接口或外部网络。
                只写入已核验的互动状态；图片内嵌，请用浏览器直接打开。它是网页体验，不能替代平台图文。
              </p>
              <button type="button" className="btn primary" onClick={doHtml} disabled={working}>{working ? "生成中…" : "下载互动网页"}</button>
            </>
          ) : (
            <p className="muted small">本版本没有互动网页，不提供该导出。</p>
          )}
        </div>
      </div>
      {msg && <p className="notice-inline" role="status">{msg}</p>}
      {err && <p className="alert alert-error" role="alert">{err}</p>}
      <p className="muted small">
        导出能力说明：以上文件由前端根据当前版本的已核验数据生成。后端尚未提供统一的 HTML 导出与离线包接口，
        待主 Agent 提供后将改为服务端生成。当前不提供“离线包”（HTML 与图片分离的压缩包）。
      </p>
    </div>
  );
}
