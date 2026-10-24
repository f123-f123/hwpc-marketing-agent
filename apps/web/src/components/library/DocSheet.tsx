import { useEffect, useRef } from "react";
import { LIBRARY_SECTION_LABEL } from "@hwpc/contracts";
import { marketingApi } from "../../api/marketing";
import { useLoad } from "../../lib/useLoad";
import type { Auth } from "../../state/useAuth";
import { Alert, Badge } from "../ui";

/** 资料原文弹层：只读，按小节展示知识库文档全文（不改写）。 */
export function DocSheet({ auth, docId, onClose }: { auth: Auth; docId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const doc = useLoad(() => marketingApi.catalogDoc(docId), [docId], auth.handleError);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const d = doc.data;
  return (
    <dialog ref={dialog} className="sheet lib-doc" onClose={onClose} aria-labelledby="lib-doc-title">
      <header className="sheet-head">
        <h2 id="lib-doc-title">{d?.title ?? "资料原文"}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog.current?.close()} aria-label="关闭">关闭</button>
      </header>
      {d && (
        <p className="muted small">
          <Badge>{LIBRARY_SECTION_LABEL[d.section]}</Badge> 出处：{d.source.locator}
        </p>
      )}
      {doc.error && <Alert tone="danger">{doc.error}</Alert>}
      {!d && !doc.error && <div className="skeleton skeleton-block" />}
      {d && (
        <div className="lib-doc-body">
          {d.parts.map((p, i) => (
            <section key={i}>
              {p.heading && <h3>{p.heading}</h3>}
              <p>{p.text}</p>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}
