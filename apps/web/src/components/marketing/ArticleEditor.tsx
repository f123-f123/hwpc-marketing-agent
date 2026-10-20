import { useState } from "react";
import type { Article } from "@hwpc/contracts";

/**
 * 修改选定稿：只改文字，结构（段落与图片顺序、事实绑定）保持不变。
 * 保存后服务端重新核验；新加的参数如果资料里没有，会被删除并在核验结果里说明。
 */
export function ArticleEditor({ article, busy, onSave, onCancel }: {
  article: Article;
  busy: boolean;
  onSave: (a: Article) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Article>(article);
  const [tags, setTags] = useState(article.tags.join("，"));
  const setBlock = (i: number, patch: { heading?: string; text?: string; caption?: string }) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as typeof b) : b)) }));

  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave({ ...draft, tags: tags.split(/[,，\s#]+/).map((t) => t.trim()).filter(Boolean) });
      }}
    >
      <p className="muted small">参数类数字请保持原样；新增的参数如果资料里没有，保存时会被核验删除。门店地址和活动来自“门店资料”，不必在这里改。</p>
      <label className="field"><span>标题</span><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
      {draft.lead !== undefined && <label className="field"><span>导语 / 副标题</span><textarea className="textarea" rows={2} value={draft.lead} onChange={(e) => setDraft({ ...draft, lead: e.target.value })} /></label>}
      {draft.blocks.map((b, i) =>
        b.type === "paragraph" ? (
          <fieldset className="editor-block" key={i}>
            <legend>第 {i + 1} 段</legend>
            {b.heading !== undefined && <input className="input" aria-label={`第 ${i + 1} 段小标题`} value={b.heading} onChange={(e) => setBlock(i, { heading: e.target.value })} />}
            <textarea className="textarea" aria-label={`第 ${i + 1} 段正文`} rows={3} value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} required />
          </fieldset>
        ) : (
          <label className="field" key={i}><span>第 {i + 1} 块 · 图注</span><input className="input" value={b.caption} onChange={(e) => setBlock(i, { caption: e.target.value })} required /></label>
        ),
      )}
      <label className="field"><span>行动引导</span><textarea className="textarea" rows={3} value={draft.callToAction} onChange={(e) => setDraft({ ...draft, callToAction: e.target.value })} required /></label>
      {(article.platform === "xiaohongshu" || article.platform === "wechat_article") && (
        <label className="field"><span>话题标签（逗号分隔）</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "正在核验…" : "保存并重新核验"}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </form>
  );
}
