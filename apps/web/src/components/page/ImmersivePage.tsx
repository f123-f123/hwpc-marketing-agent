import { useRef, useState } from "react";
import type { ExperiencePage, SessionSnapshot } from "@hwpc/contracts";
import type { Notice, SessionActions } from "../../state/useSession";
import { useSceneEntry } from "../../state/useSceneEntry";
import { SceneOverlay } from "../SceneOverlay";
import { Icon } from "../ui";
import { QaDrawer } from "./QaDrawer";
import { CandidateSection, ExperienceSection, HeroSection, NeedsSection, PlanSection } from "./sections";
import { useImmersive } from "./useImmersive";

/** 进度条上每个版块的短名。 */
function railLabel(s: ExperiencePage["sections"][number]): string {
  switch (s.kind) {
    case "hero": return "开场";
    case "needs": return "你的日常";
    case "candidate": return s.name.replace(/^【MOCK】/, "");
    case "experience": return "动手体验";
    case "plan": return "方案";
  }
}

/**
 * 沉浸式体验页（全屏）。顶栏、进度条、侧边提问都浮在页面之上；场景任务以浮层打开，关掉回到原位。
 * 页面内容只来自快照里的 page（绑定方案版本），这里不做任何业务推演。
 */
export function ImmersivePage({ snap, page, busy, notice, actions, onConsult }: {
  snap: SessionSnapshot;
  page: ExperiencePage;
  busy: boolean;
  notice: Notice | null;
  actions: SessionActions;
  onConsult: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [qaOpen, setQaOpen] = useState(false);
  const scene = useSceneEntry(snap, actions);
  const { active, pastHero } = useImmersive(root, `${page.pageId}:${page.updatedAt}`);

  const sections = page.sections;
  const candidates = sections.filter((s) => s.kind === "candidate");
  const idOf = (kind: string) => sections.find((s) => s.kind === kind)?.sectionId;
  const jump = (id?: string) => id && document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const stale = snap.plan.current?.needsReview || snap.needs.status !== "confirmed";

  return (
    <div className={`ip${qaOpen ? " qa-open" : ""}${pastHero ? "" : " on-dark"}`} ref={root}>
      <header className={`ip-nav${pastHero ? " is-solid" : ""}`}>
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>华为 PC</span>
          <span className="brand-sub">你的体验页</span>
        </span>
        <span className="spacer" />
        {snap.isMock && <span className="ip-mock">含模拟内容</span>}
        <button type="button" className="btn btn-sm ip-nav-btn" onClick={onConsult}><Icon name="back" />需求沟通</button>
        <button type="button" className="btn btn-sm ip-nav-btn" onClick={actions.reset}><Icon name="plus" />新咨询</button>
      </header>

      {stale && (
        <div className="ip-stale" role="status">
          {snap.needs.status !== "confirmed" ? "需求有变化，这一页还是按之前确认的需求生成的。" : "你提交了新的反馈，方案需要复核。"}
          <button type="button" className="link" onClick={onConsult}>回到需求沟通</button>
        </div>
      )}

      <nav className="ip-rail" aria-label="页面进度">
        <ol>
          {sections.map((s) => (
            <li key={s.sectionId} className={active === s.sectionId ? "is-active" : undefined}>
              <a href={`#${s.sectionId}`} onClick={(e) => { e.preventDefault(); jump(s.sectionId); }} aria-current={active === s.sectionId ? "true" : undefined}>
                <span className="ip-rail-dot" aria-hidden="true" />
                <span className="ip-rail-label">{railLabel(s)}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main className="ip-main">
        {sections.map((s, i) => {
          switch (s.kind) {
            case "hero": return <HeroSection key={s.sectionId} s={s} nextId={sections[i + 1]?.sectionId} />;
            case "needs": return <NeedsSection key={s.sectionId} s={s} />;
            case "candidate": return <CandidateSection key={s.sectionId} s={s} index={candidates.indexOf(s)} total={candidates.length} />;
            case "experience":
              return (
                <ExperienceSection
                  key={s.sectionId}
                  s={s}
                  snap={snap}
                  onEnterScene={(id) => void scene.enter(id)}
                  onOpenInstance={scene.open}
                  onActivity={(a) => jump(a === "compare" ? candidates[0]?.sectionId : idOf("plan"))}
                />
              );
            case "plan": return <PlanSection key={s.sectionId} s={s} snap={snap} onConsult={onConsult} />;
          }
        })}
      </main>

      {!qaOpen && (
        <button type="button" className="qa-launch" onClick={() => setQaOpen(true)}>
          <Icon name="message" />有疑问？问问顾问{snap.qa.length > 0 && <span className="qa-count">{snap.qa.length}</span>}
        </button>
      )}
      <QaDrawer snap={snap} busy={busy} open={qaOpen} onClose={() => setQaOpen(false)} onAsk={actions.ask} onConsult={onConsult} />

      {notice && (
        <div className={`ip-toast ip-toast-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={actions.dismiss}>知道了</button>
        </div>
      )}

      {scene.active && (
        <SceneOverlay view={scene.active} busy={busy} onClose={scene.close} onAction={(id, a) => void actions.action(id, a)} onFeedback={actions.feedback} />
      )}
    </div>
  );
}
