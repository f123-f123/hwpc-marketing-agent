import { useEffect, useMemo, useState } from "react";
import type { PagePoint, PageSection, SessionSnapshot } from "@hwpc/contracts";
import { showroomSpace, type Hotspot } from "@hwpc/scenes";
import { api } from "../../api/client";
import { COMPLETION_LABEL, ENTRY_STATUS_LABEL } from "../../lib/labels";
import { KEYS, readJson, writeJson } from "../../lib/storage";
import { DEFAULT_VIEW, Panorama, isView, type View } from "../../scenes/Panorama";
import { Badge, Icon } from "../ui";
import { SLOT_ORIGIN_LABEL, SlotImage } from "./SlotImage";

type Of<K extends PageSection["kind"]> = Extract<PageSection, { kind: K }>;

const ROLE_LABEL = { recommended: "首选", alternative: "备选", not_recommended: "暂不推荐", unranked: "候选" } as const;

/* ------------------------------ 开场（深色） ------------------------------ */

export function HeroSection({ s, nextId }: { s: Of<"hero">; nextId?: string }) {
  const filled = s.image.status === "filled" && s.image.image;
  return (
    <section className="ip-hero" id={s.sectionId} data-section data-hero aria-labelledby={`${s.sectionId}-t`}>
      <div className={`ip-hero-media${filled ? " has-image" : ""}`} aria-hidden={!filled}>
        {filled ? <SlotImage slot={s.image} tone="dark" /> : <div className="ip-hero-glow" />}
      </div>
      <div className="ip-hero-inner">
        <p className="ip-eyebrow" data-reveal>{s.eyebrow}</p>
        <h1 id={`${s.sectionId}-t`} className="ip-hero-title" data-reveal>{s.headline}</h1>
        {s.lede.status === "filled" && <p className="ip-hero-lede" data-reveal>{s.lede.text}</p>}
        {s.chips.length > 0 && (
          <ul className="ip-chips" data-reveal aria-label="你的需求要点">
            {s.chips.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {nextId && <a className="ip-cue" href={`#${nextId}`} data-reveal>往下看<Icon name="right" /></a>}
      </div>
      {!filled && <p className="ip-hero-note">场景图待接入 · {s.image.intent}</p>}
    </section>
  );
}

/* ------------------------------ 你的日常 ------------------------------ */

export function NeedsSection({ s }: { s: Of<"needs"> }) {
  return (
    <section className="ip-sec ip-needs-sec" id={s.sectionId} data-section aria-labelledby={`${s.sectionId}-t`}>
      <div className="ip-wrap">
        <h2 id={`${s.sectionId}-t`} className="ip-title" data-reveal>{s.title}</h2>
        <p className="ip-lede" data-reveal>这是你确认过的那一版需求。下面的每个推荐，都从这里出发。</p>
        <dl className="ip-needs">
          {s.items.map((i) => (
            <div key={i.label} className="ip-need" data-reveal>
              <dt>{i.label}</dt>
              <dd>
                {i.values.map((v) => (
                  <p key={v.text}>
                    {v.text}
                    {v.hard && <span className="ip-tag ip-tag-primary">硬条件</span>}
                    {v.status !== "known" && <span className="ip-tag">{ENTRY_STATUS_LABEL[v.status] ?? v.status}</span>}
                  </p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------ 候选：左图（固定）右文 ------------------------------ */

function Points({ title, tone, points }: { title: string; tone: "ok" | "warn" | "bad" | "muted"; points: PagePoint[] }) {
  if (!points.length) return null;
  return (
    <div className={`ip-points ip-points-${tone}`} data-reveal>
      <h3>{title}</h3>
      <ul>
        {points.map((p, i) => (
          <li key={i}>
            <span>{p.text}{p.hard && <span className="ip-tag ip-tag-primary">硬条件</span>}</span>
            {p.evidence.length > 0 && (
              <details className="ip-evidence">
                <summary>依据（{p.evidence.length}）</summary>
                {p.evidence.map((e, j) => (
                  <blockquote key={j}><cite>{e.title}</cite>{e.quote && <p>“{e.quote}”</p>}</blockquote>
                ))}
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CandidateSection({ s, index, total }: { s: Of<"candidate">; index: number; total: number }) {
  const qualifiers = [...new Set([...s.intro.qualifiers, ...s.highlights.flatMap((h) => h.qualifiers)])];
  return (
    <section className={`ip-cand ip-cand-${s.role} ip-tone-${index % 2 ? "warm" : "cool"}`} id={s.sectionId} data-section aria-labelledby={`${s.sectionId}-t`}>
      <div className="ip-cand-inner">
      <div className="ip-cand-media">
        <div className="ip-sticky">
          <SlotImage slot={s.image} tone="light" title={s.name} />
        </div>
      </div>
      <div className="ip-cand-body">
        <p className="ip-kicker" data-reveal>
          <span className={s.role === "recommended" ? "is-primary" : undefined}>{ROLE_LABEL[s.role]}</span>
          <span>候选 {index + 1} / {total}</span>
          {s.isMock && <span className="ip-tag ip-tag-warn">模拟资料</span>}
        </p>
        <h2 id={`${s.sectionId}-t`} className="ip-cand-name" data-reveal>{s.name}</h2>
        <p className="ip-verdict" data-reveal>{s.verdict}</p>
        {s.intro.status === "filled" ? (
          <p className="ip-intro" data-reveal>
            {s.intro.text}
            {s.intro.origin && <span className="ip-origin">{SLOT_ORIGIN_LABEL[s.intro.origin]}</span>}
          </p>
        ) : (
          <p className="ip-intro is-pending" data-reveal>产品介绍待补充：资料接入后会写在这里。</p>
        )}
        {s.highlights.length > 0 && (
          <dl className="ip-figures" data-reveal>
            {s.highlights.map((h) => (
              <div key={`${h.label}${h.value}`}>
                <dd className={h.value.length > 10 ? "is-long" : undefined}>{h.value}</dd>
                <dt>{h.label}</dt>
              </div>
            ))}
          </dl>
        )}
        {qualifiers.length > 0 && <p className="ip-qualifiers" data-reveal>{qualifiers.join("；")}</p>}
        <Points title="满足你的" tone="ok" points={s.satisfied} />
        <Points title="需要取舍" tone="warn" points={s.compromises} />
        <Points title="不满足" tone="bad" points={s.unmet} />
        <Points title="资料未确认（不算满足）" tone="muted" points={s.unknowns} />
      </div>
      </div>
    </section>
  );
}

/* ------------------------------ 动手体验：三维空间 + 任务 ------------------------------ */

export function ExperienceSection({ s, snap, onEnterScene, onOpenInstance, onActivity }: {
  s: Of<"experience">;
  snap: SessionSnapshot;
  onEnterScene: (sceneId: string) => void;
  onOpenInstance: (instanceId: string) => void;
  onActivity: (activity: "compare" | "plan") => void;
}) {
  const [view, setView] = useState<View>(() => readJson(KEYS.view, isView) ?? DEFAULT_VIEW);
  useEffect(() => {
    const t = setTimeout(() => writeJson(KEYS.view, view), 300);
    return () => clearTimeout(t);
  }, [view]);

  const catalog = useMemo(() => snap.scenes.catalog.filter((c) => c.status === "active" && c.integrity === "ok"), [snap.scenes.catalog]);
  const space = useMemo(
    () => ({ ...showroomSpace, hotspots: showroomSpace.hotspots.filter((h) => h.target.type !== "scene" || catalog.some((c) => c.sceneId === (h.target as { sceneId: string }).sceneId)) }),
    [catalog],
  );
  const instances = snap.scenes.instances;
  const planned = s.scenes.map((x) => x.sceneId);
  const doneIds = instances.filter((v) => v.instance.status === "active" && v.experience.completion === "walkthrough_completed").map((v) => v.instance.sceneId);
  const progressOf = (instanceId: string) => instances.find((v) => v.instance.instanceId === instanceId)?.experience.completion;
  const others = catalog.filter((c) => !planned.includes(c.sceneId));

  return (
    <section className="ip-sec ip-exp" id={s.sectionId} data-section aria-labelledby={`${s.sectionId}-t`}>
      <div className="ip-wrap">
        <h2 id={`${s.sectionId}-t`} className="ip-title" data-reveal>{s.title}</h2>
        <p className="ip-lede" data-reveal>{s.lede}</p>
      </div>
      <div className="ip-wrap-wide" data-reveal>
        <Panorama
          space={space}
          view={view}
          onView={setView}
          onEnter={(h: Hotspot) => (h.target.type === "scene" ? onEnterScene(h.target.sceneId) : onActivity(h.target.activity))}
          recommendedSceneIds={planned}
          doneSceneIds={doneIds}
        />
      </div>
      <div className="ip-wrap">
        {s.scenes.length > 0 && (
          <ol className="ip-tasks" aria-label="方案安排的场景">
            {s.scenes.map((x, i) => {
              const progress = progressOf(x.instanceId);
              return (
                <li key={x.instanceId} data-reveal>
                  <button type="button" className="ip-task" onClick={() => onOpenInstance(x.instanceId)}>
                    <span className="ip-task-no">{String(i + 1).padStart(2, "0")}</span>
                    <span className="ip-task-main"><strong>{x.title}</strong><span>{x.reason}</span></span>
                    {progress && progress !== "not_started" && <Badge tone={progress === "walkthrough_completed" ? "success" : "neutral"}>{COMPLETION_LABEL[progress]}</Badge>}
                    <Icon name="right" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {others.length > 0 && (
          <p className="ip-more" data-reveal>
            也可以看看通用演示：
            {others.map((c, i) => (
              <span key={c.sceneId}>{i > 0 && "、"}<button type="button" className="link" onClick={() => onEnterScene(c.sceneId)}>{c.title}</button></span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------ 方案 ------------------------------ */

export function PlanSection({ s, snap, onConsult }: { s: Of<"plan">; snap: SessionSnapshot; onConsult: () => void }) {
  return (
    <section className="ip-sec ip-plan" id={s.sectionId} data-section aria-labelledby={`${s.sectionId}-t`}>
      <div className="ip-wrap">
        <h2 id={`${s.sectionId}-t`} className="ip-title" data-reveal>{s.title}</h2>
        {s.primaryName ? (
          <div className="ip-primary" data-reveal>
            <p className="ip-kicker"><span className="is-primary">首选</span></p>
            <p className="ip-primary-name">{s.primaryName}</p>
            {s.primaryReason && <p className="ip-verdict">{s.primaryReason}</p>}
          </div>
        ) : (
          <p className="ip-verdict" data-reveal>这次没有给出首选：{s.noRecommendationReason ?? "现有资料不足以判断。"}</p>
        )}
        {s.others.length > 0 && (
          <ul className="ip-others" data-reveal>
            {s.others.map((o) => <li key={o.name}><strong>{o.name}</strong><span className="ip-tag">{ROLE_LABEL[o.role]}</span><p>{o.reason}</p></li>)}
          </ul>
        )}
        <p className={`ip-check${s.verificationOk ? "" : " is-warn"}`} data-reveal>
          {s.verificationOk ? "方案核验通过" : "方案核验未通过"}：{s.checks.map((c) => c.detail).join("；")}
        </p>
        <div className="ip-actions" data-reveal>
          <a className="btn btn-primary btn-lg" href={api.exportUrl(snap)} target="_blank" rel="noopener">保存这份方案<Icon name="external" /></a>
          <button type="button" className="btn btn-lg" onClick={onConsult}>回到需求沟通</button>
        </div>
        <p className="ip-foot" data-reveal>
          这一页对应方案 v{snap.page?.planVersion}（需求 v{snap.page?.needVersion}）。之后的提问不会改变它；需求有变化时，回到需求沟通重新确认，会生成新的一页。
          {snap.isMock && " 本页含模拟内容，不能作为实机或真实资料的依据。"}
        </p>
      </div>
    </section>
  );
}
