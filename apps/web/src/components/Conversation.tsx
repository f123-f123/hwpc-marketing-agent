import { useEffect, useRef, useState } from "react";
import type { AdvisorQuestion, AdvisorSnapshot, ChatMessage } from "../advisor/types";

interface AnswerDraft {
  option?: string;
  text?: string;
}

interface Props {
  snap: AdvisorSnapshot;
  busy: boolean;
  onSend: (text: string) => void;
  onAnswer: (answers: { questionId: string; optionValue?: string; text?: string }[], freeText?: string) => void;
  onEdit: (messageId: string, text: string) => void;
}

function Bubble({ m, disabled, onEdit, canEdit }: { m: ChatMessage; disabled: boolean; onEdit: (id: string, text: string) => void; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  return (
    <li className={`msg msg-${m.role}`}>
      <span className="msg-who">{m.role === "user" ? "你" : "顾问"}</span>
      {editing ? (
        <div className="msg-edit">
          <textarea aria-label="修改这条表达" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={disabled || !draft.trim()}
              onClick={() => {
                onEdit(m.messageId, draft.trim());
                setEditing(false);
              }}
            >
              用修改后的表达重新整理
            </button>
            <button type="button" className="btn" onClick={() => (setEditing(false), setDraft(m.text))}>取消</button>
          </div>
          <p className="muted small">这条之后的对话、检索结果与摘要会按新的表达重新生成。</p>
        </div>
      ) : (
        <div className="msg-body">
          <p>{m.text}</p>
          {m.role === "user" && canEdit && m.editable && (
            <button type="button" className="link" onClick={() => setEditing(true)} disabled={disabled}>
              修改这句
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function QuestionCard({ q, draft, onChange, disabled }: { q: AdvisorQuestion; draft: AnswerDraft; onChange: (d: AnswerDraft) => void; disabled: boolean }) {
  return (
    <fieldset className={`question q-${q.category}`} disabled={disabled}>
      <legend>
        <span className={`tag ${q.category === "material" ? "tag-material" : "tag-pref"}`}>{q.category === "material" ? "资料情况" : "需要你定"}</span>
        {q.prompt}
      </legend>
      {q.why && <p className="muted small">{q.why}</p>}
      <div className="options" role="radiogroup" aria-label={q.prompt}>
        {q.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={draft.option === o.value}
            className={`chip ${draft.option === o.value ? "on" : ""}`}
            onClick={() => onChange({ ...draft, option: draft.option === o.value ? undefined : o.value })}
          >
            {o.label}
            {o.hint && <small>{o.hint}</small>}
          </button>
        ))}
      </div>
      {q.allowFreeText && (
        <input
          type="text"
          className="free"
          placeholder="或者用你自己的话补充"
          aria-label={`${q.prompt} 的补充`}
          value={draft.text ?? ""}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
        />
      )}
    </fieldset>
  );
}

export function Conversation({ snap, busy, onSend, onAnswer, onEdit }: Props) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const qKey = snap.questions.map((q) => q.questionId).join("|");

  useEffect(() => {
    setDrafts({});
  }, [qKey]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [snap.messages.length, qKey, snap.progress.length]);

  const working = snap.phase === "retrieving" || snap.phase === "producing";
  const hasQuestions = snap.questions.length > 0;
  const answered = snap.questions.some((q) => drafts[q.questionId]?.option || drafts[q.questionId]?.text?.trim());
  const canEdit = snap.capabilities.amendMessages;

  const submit = () => {
    const free = text.trim();
    if (hasQuestions) {
      const answers = snap.questions
        .map((q) => ({ questionId: q.questionId, optionValue: drafts[q.questionId]?.option, text: drafts[q.questionId]?.text?.trim() || undefined }))
        .filter((a) => a.optionValue || a.text);
      if (!answers.length && !free) return;
      onAnswer(answers, free || undefined);
    } else if (free) onSend(free);
    setText("");
  };

  const placeholder =
    snap.phase === "delivered"
      ? "提出内容修改，例如：语气更轻松一点"
      : hasQuestions
        ? "也可以直接用一段话回答上面的问题，我会自己对应"
        : snap.phase === "awaiting_confirmation"
          ? "还想调整？直接说，我会更新摘要"
          : "继续补充你的想法";

  return (
    <section className="chat" aria-label="与顾问的对话">
      <ol className="messages" aria-live="polite">
        {snap.messages.map((m) => (
          <Bubble key={m.messageId} m={m} disabled={busy || working} onEdit={onEdit} canEdit={canEdit} />
        ))}
        {working && snap.progress.length > 0 && (
          <li className="msg msg-advisor">
            <span className="msg-who">顾问</span>
            <div className="msg-body">
              <p>{snap.phase === "retrieving" ? "正在查看资料：" : "正在制作："}</p>
              <ul className="progress" aria-label="执行进度">
                {snap.progress.map((p) => (
                  <li key={p.stepId} className={`step step-${p.state}`}>
                    <span className="dot" aria-hidden />
                    <span>
                      {p.purpose}
                      {p.resultNote && <em>　{p.resultNote}</em>}
                      {p.simulated && <span className="tag tag-mock">模拟步骤</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )}
      </ol>

      {hasQuestions && (
        <div className="questions" aria-label="待回答的问题">
          {snap.questions.map((q) => (
            <QuestionCard key={q.questionId} q={q} draft={drafts[q.questionId] ?? {}} onChange={(d) => setDrafts((p) => ({ ...p, [q.questionId]: d }))} disabled={busy} />
          ))}
          <p className="muted small">不用逐题回答：写一段话或只选其中几项都可以。</p>
        </div>
      )}
      <div ref={endRef} />

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="composer-input">发送给顾问</label>
        <textarea
          id="composer-input"
          rows={2}
          value={text}
          placeholder={placeholder}
          disabled={busy || working}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || working || (hasQuestions ? !answered && !text.trim() : !text.trim())}>
          {hasQuestions ? "提交回答" : "发送"}
        </button>
      </form>
    </section>
  );
}
