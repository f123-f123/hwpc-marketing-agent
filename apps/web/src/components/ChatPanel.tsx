import { useEffect, useRef, useState } from "react";
import type { SessionQuestion, SessionSnapshot } from "@hwpc/contracts";
import type { SessionActions } from "../state/useSession";
import { Icon } from "./ui";

function Questions({ questions, busy, onSubmit }: {
  questions: SessionQuestion[];
  busy: boolean;
  onSubmit: (answers: { questionId: string; answer: string }[]) => Promise<unknown>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, value: string) => setAnswers((x) => ({ ...x, [id]: value }));
  const selected = questions.filter((q) => answers[q.questionId]?.trim()).map((q) => ({ questionId: q.questionId, answer: answers[q.questionId]!.trim() }));

  return (
    <form
      className="questions"
      aria-label="顾问的问题"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!selected.length) return;
        // 只有提交成功才清空，失败时保留已选的回答。
        if (await onSubmit(selected)) setAnswers({});
      }}
    >
      <p className="questions-title">顾问想了解 {questions.length} 件事 <span className="muted">· 回答其中几个也可以</span></p>
      {questions.map((q) => (
        <fieldset className="question" key={q.questionId}>
          <legend>{q.prompt}</legend>
          {q.reason && <p className="question-reason">{q.reason}</p>}
          {q.options && q.options.length > 0 && (
            <div className="row">
              {q.options.map((o) => {
                const on = answers[q.questionId] === o.value;
                return (
                  <button type="button" key={o.value} className="chip" aria-pressed={on} disabled={busy} onClick={() => set(q.questionId, on ? "" : o.value)}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          {q.allowFreeText && (
            <input
              className="input"
              aria-label={`回答：${q.prompt}`}
              placeholder="也可以直接写"
              value={q.options?.some((o) => o.value === answers[q.questionId]) ? "" : (answers[q.questionId] ?? "")}
              onChange={(e) => set(q.questionId, e.target.value)}
            />
          )}
        </fieldset>
      ))}
      <button type="submit" className="btn btn-primary" disabled={busy || selected.length === 0}>
        提交 {selected.length > 0 ? `${selected.length} 个回答` : "回答"}
      </button>
    </form>
  );
}

export function ChatPanel({ snap, busy, actions, onOpenScene }: {
  snap: SessionSnapshot;
  busy: boolean;
  actions: Pick<SessionActions, "send" | "answer">;
  onOpenScene: (sceneId: string) => void;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const { messages, openQuestions } = snap.conversation;
  const titleOf = (sceneId: string) => snap.scenes.catalog.find((c) => c.sceneId === sceneId)?.title ?? sceneId;

  // 新消息、新问题或开始等待时滚到底部。
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, openQuestions.length, busy]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (await actions.send(t)) setText("");
  };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <header className="chat-head">
        <h2 id="chat-title" className="chat-title">顾问对话</h2>
        <span className="muted small">点击和浏览不会改变需求，只有你说的话和提交的反馈会</span>
      </header>

      <div className="chat-scroll" ref={scroller}>
        <ol className="messages" aria-live="polite">
          {messages.map((m) => (
            <li key={m.messageId} className={`msg msg-${m.role}`}>
              <span className="msg-who">{m.role === "user" ? "我" : m.role === "advisor" ? "顾问" : "提示"}</span>
              <div className="msg-body">
                <p>{m.text}</p>
                {m.suggestedScenes && m.suggestedScenes.length > 0 && (
                  <div className="msg-suggest">
                    {m.suggestedScenes.map((s) => (
                      <button type="button" key={s.sceneId} className="chip" onClick={() => onOpenScene(s.sceneId)}>
                        看看：{titleOf(s.sceneId)}
                      </button>
                    ))}
                  </div>
                )}
                {m.references && m.references.length > 0 && (
                  <details className="msg-refs">
                    <summary>知识库出处 {m.references.length} 条</summary>
                    <ul>
                      {m.references.map((r) => (
                        <li key={`${r.locator ?? ""}${r.title}`}>
                          <span className="msg-ref-title">{r.section && <span className="msg-ref-section">{r.section}</span>}{r.title}</span>
                          {r.excerpt && <q className="msg-ref-quote">{r.excerpt}</q>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
          {busy && (
            <li className="msg msg-advisor" aria-label="顾问正在处理">
              <span className="msg-who">顾问</span>
              <div className="msg-body msg-typing"><span /><span /><span /></div>
            </li>
          )}
        </ol>
        {openQuestions.length > 0 && <Questions key={openQuestions.map((q) => q.questionId).join()} questions={openQuestions} busy={busy} onSubmit={actions.answer} />}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="chat-input">补充用途、硬条件或疑问</label>
        <textarea
          id="chat-input"
          className="composer-input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          placeholder="补充你的用途、硬条件或疑问（Enter 发送）"
        />
        <button type="submit" className="btn btn-primary composer-send" disabled={busy || !text.trim()} aria-label="发送">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}
