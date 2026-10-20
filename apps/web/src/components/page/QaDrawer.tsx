import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@hwpc/contracts";
import { Icon } from "../ui";

/**
 * 侧边提问：接答疑智能体，与生成页面的顾问是两个智能体。
 * 这里的回答只记录、不改页面；问题涉及改需求时，给出“回到需求沟通”。
 */
export function QaDrawer({ snap, busy, open, onClose, onAsk, onConsult }: {
  snap: SessionSnapshot;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onAsk: (question: string) => Promise<unknown>;
  onConsult: () => void;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const turns = snap.qa;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, open]);

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    if (await onAsk(q)) setText("");
  };

  return (
    <aside className={`qa${open ? " is-open" : ""}`} aria-label="问问顾问" aria-hidden={!open} inert={!open}>
      <header className="qa-head">
        <div>
          <h2>问问顾问</h2>
          <p>回答只帮你理解这一页，不会改动方案。要改需求，请回到需求沟通。</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="收起提问"><Icon name="close" /></button>
      </header>

      <div className="qa-scroll" ref={scroller}>
        {turns.length === 0 && (
          <div className="qa-empty">
            <p>可以这样问：</p>
            {["推荐哪一款？为什么", "它有多重", "要接受哪些取舍", "传文件怎么用"].map((q) => (
              <button key={q} type="button" className="chip" disabled={busy} onClick={() => void onAsk(q)}>{q}</button>
            ))}
          </div>
        )}
        <ol className="qa-turns" aria-live="polite">
          {turns.map((t) => (
            <li key={t.turnId}>
              <p className="qa-q"><span>我</span>{t.question}</p>
              <div className={`qa-a${t.failed ? " is-failed" : ""}`}>
                <span>顾问</span>
                <div>
                  <p>{t.reply}</p>
                  {t.citations.length > 0 && <p className="qa-cite">依据：{t.citations.map((c) => c.title).join("、")}</p>}
                  {t.suggestNeedChange && <button type="button" className="btn btn-sm" onClick={onConsult}>回到需求沟通</button>}
                </div>
              </div>
            </li>
          ))}
          {busy && <li className="qa-typing" aria-label="顾问正在回答"><span /><span /><span /></li>}
        </ol>
      </div>

      <form className="composer qa-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="qa-input">你的问题</label>
        <textarea
          id="qa-input"
          ref={input}
          className="composer-input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          placeholder="关于这一页的任何疑问（Enter 发送）"
        />
        <button type="submit" className="btn btn-primary composer-send" disabled={busy || !text.trim()} aria-label="发送"><Icon name="send" /></button>
      </form>
    </aside>
  );
}
