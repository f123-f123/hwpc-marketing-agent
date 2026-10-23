import { useEffect, useState } from "react";
import { Icon, type IconName } from "../../components/ui";
import {
  ITEMS, RATE, SLIDES, SLIDE_MIN, bagKg, bagOf, cafeHoursOf, clockText, cmCoach, cmHint, cmInitial, cmReduce, cmReview, cmSteps, drain, hasSocket, hoursLeft, maxCafeHours,
  CM_START, type CmConfig, type CmEvent, type CmHint, type CmItem, type CmLocal, type CmState,
} from "../flows/commute";
import { Laptop, StageCoach, Taskbar, type StageProps } from "./devices";
import { ReplayTools, useReplay } from "./replay";
import { useDrag } from "./useDrag";

const ITEM_ICON: Record<CmItem, IconName> = { laptop: "laptop", charger: "plug", mouse: "mouse" };
const PLACE: Record<CmState, { label: string; icon: IconName }> = {
  morning: { label: "家里 · 出门前", icon: "home" },
  meeting: { label: "公司 · 会议室", icon: "slides" },
  cafe: { label: "咖啡厅", icon: "coffee" },
  evening: { label: "傍晚 · 回到家", icon: "home" },
};
const SLIDE_TITLES = ["今天的议题", "需求回顾", "方案对比", "下一步安排"];

/** 示意电量条：低于 25% 变色，耗尽时显示 0%；插着电时带闪电。 */
function Battery({ value, charging }: { value: number; charging: boolean }) {
  const v = Math.round(value);
  return (
    <span className={`cm-bat${v <= 0 ? " is-empty" : v < 25 ? " is-low" : ""}`} aria-label={`示意电量 ${v}%${charging ? "，充电中" : ""}`}>
      <span className="cm-bat-cell" aria-hidden="true"><i style={{ width: `${Math.max(0, v)}%` }} /></span>
      {charging && <Icon name="bolt" size={12} />}
      <b>{v}%</b>
    </span>
  );
}

/** 物品示意图：程序画的通用形状，不是产品图。 */
function ItemArt({ item }: { item: CmItem }) {
  if (item === "laptop") return <svg viewBox="0 0 60 40" aria-hidden="true"><rect x="6" y="4" width="48" height="28" rx="2" className="cm-art-alu" /><rect x="2" y="32" width="56" height="4" rx="2" className="cm-art-alu-lo" /></svg>;
  if (item === "charger") return <svg viewBox="0 0 60 40" aria-hidden="true"><rect x="18" y="8" width="20" height="20" rx="4" className="cm-art-white" /><path d="M38 18 C 50 18, 52 30, 44 34" className="cm-art-cable" /><path d="M22 4v4M34 4v4" className="cm-art-cable" /></svg>;
  return <svg viewBox="0 0 60 40" aria-hidden="true"><rect x="20" y="4" width="20" height="32" rx="10" className="cm-art-dark" /><path d="M30 4v12" className="cm-art-line" /></svg>;
}

/**
 * 【MOCK】通勤一天：收拾背包 → 通勤 → 会议室演示 →（咖啡厅办公）→ 回家看回顾。
 * 重量、耗电都是虚拟设定，只有关键节点提交服务端动作（见 flows/commute.ts）。
 */
export function CommuteStage({ view, disabled, onAction }: StageProps) {
  const replay = useReplay(view, onAction);
  const server = replay.current as CmState;
  const p = view.instance.params;
  const cfg: CmConfig = {
    mode: p.commuteMode === "car" ? "car" : "metro",
    hoursOutside: typeof p.hoursOutside === "number" ? p.hoursOutside : 4,
    hasCafe: view.definition.states.some((s) => s.stateId === "cafe"),
  };
  const [local, setLocal] = useState(cmInitial);
  const coach = cmCoach(server, local, cfg);
  const hint = cmHint(server, local, cfg);
  const nx = (h: CmHint) => (!disabled && hint === h ? " is-next" : "");
  const dispatch = (e: CmEvent) => {
    if (disabled) return;
    const r = cmReduce(server, local, e, cfg);
    setLocal(r.local);
    if (r.action) replay.act(r.action);
  };
  const dnd = useDrag<CmItem>((item, zone) => {
    if ((zone === "bag") !== local.bag.includes(item)) dispatch({ type: "pack", item });
  });

  // 通勤动画走完再提交“到公司”。
  useEffect(() => {
    if (!local.leaving || disabled) return;
    const t = setTimeout(() => dispatch({ type: "arrive" }), 2600);
    return () => clearTimeout(t);
  }, [local.leaving, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const bag = bagOf(server, local);
  const kg = bagKg(bag);
  const charger = bag.includes("charger");
  const socket = hasSocket(server, local);
  const hours = cafeHoursOf(local, cfg);
  const place = local.leaving ? null : server;

  const bagButton = (label: string) => (
    <button type="button" className={`cm-bag-seat${nx("bag")}`} disabled={disabled || local.laptopOut} onClick={() => dispatch({ type: "take_out" })} aria-label={label}>
      <Icon name="bag" size={30} />
      <span>{local.laptopOut ? "背包" : "点背包拿出电脑"}</span>
    </button>
  );
  const socketButton = (
    <button type="button" className={`cm-socket${local.plugged ? " is-on" : ""}${nx("socket")}`} disabled={disabled || !local.laptopOut || !charger} onClick={() => dispatch({ type: "plug" })}
      title={!charger ? "没带充电器" : !local.laptopOut ? "先把电脑拿出来" : undefined}
      aria-label={local.plugged ? "拔下充电器" : charger ? "把充电器插到插座上" : "插座（没带充电器）"}>
      <span className="cm-socket-face" aria-hidden="true"><i /><i /></span>
      <span className="cm-socket-label">{local.plugged ? "充电中" : charger ? "插座" : "插座 · 没带充电器"}</span>
    </button>
  );
  const tray = <span className={`cm-tray-bat${local.battery < 25 ? " is-low" : ""}`}>{local.plugged && <Icon name="bolt" size={11} />}{Math.round(local.battery)}%</span>;

  return (
    <div className="stage-wrap">
      <StageCoach steps={cmSteps(cfg)} {...coach} />
      <div ref={dnd.host} {...dnd.hostProps} className={`sim sim-cm cm-at-${local.leaving ? cfg.mode : server}${disabled ? " is-disabled" : ""}`}>
        <div className="cm-hud" role="group" aria-label="今天的状态">
          <span className="cm-hud-item"><Icon name="clock" size={14} />{clockText(local.clock)}</span>
          <span className="cm-hud-item">
            <Icon name={local.leaving ? (cfg.mode === "car" ? "car" : "train") : PLACE[server].icon} size={14} />
            {local.leaving ? (cfg.mode === "car" ? "开车去公司" : "地铁上") : PLACE[server].label}
          </span>
          <span className="cm-hud-spacer" />
          <span className="cm-hud-item"><Icon name="bag" size={14} />背包 {kg} kg</span>
          <span className="cm-hud-item">示意电量 <Battery value={local.battery} charging={local.plugged} /></span>
        </div>

        {place === "morning" && (
          <div className="cm-scene cm-home">
            <div className={`cm-shelf${dnd.drag?.over === "shelf" ? " is-over" : ""}`} ref={dnd.zone("shelf")}>
              <p className="cm-zone-label">玄关柜</p>
              <div className="cm-items">
                {ITEMS.filter((i) => !local.bag.includes(i.id)).map((i) => (
                  <button key={i.id} type="button" className={`cm-item drag-src${i.id === "laptop" ? nx("laptop") : ""}${dnd.drag?.item === i.id ? " is-lifted" : ""}`} disabled={disabled}
                    {...dnd.source(i.id, !disabled)} onClick={() => dispatch({ type: "pack", item: i.id })} aria-label={`把${i.label}放进背包（${i.kg} kg）`}>
                    <ItemArt item={i.id} />
                    <span>{i.label}</span>
                    <span className="cm-muted">{i.kg} kg</span>
                  </button>
                ))}
                {local.bag.length === ITEMS.length && <p className="cm-muted">都装进包里了</p>}
              </div>
            </div>
            <div className={`cm-pack${dnd.drag?.over === "bag" ? " is-over" : ""}${dnd.drag && !local.bag.includes(dnd.drag.item) ? " is-target" : ""}`} ref={dnd.zone("bag")}>
              <svg className="cm-pack-art" viewBox="0 0 120 120" aria-hidden="true">
                <path d="M40 22 a20 20 0 0 1 40 0" className="cm-art-strap" />
                <rect x="18" y="22" width="84" height="92" rx="20" className="cm-art-bag" />
                <rect x="30" y="66" width="60" height="34" rx="10" className="cm-art-pocket" />
              </svg>
              <div className="cm-pack-inner">
                <p className="cm-zone-label">背包 · {kg} kg</p>
                {local.bag.length === 0 && <p className="cm-muted">把东西拖到这里</p>}
                {local.bag.map((id) => {
                  const i = ITEMS.find((x) => x.id === id)!;
                  return (
                    <button key={id} type="button" className="cm-chip drag-src" disabled={disabled} {...dnd.source(id, !disabled)} onClick={() => dispatch({ type: "pack", item: id })} aria-label={`把${i.label}拿出来`}>
                      <Icon name={ITEM_ICON[id]} size={13} />{i.label}<Icon name="close" size={11} />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="cm-door">
              <button type="button" className={`btn btn-primary${nx("leave")}`} disabled={disabled || !local.bag.includes("laptop")} onClick={() => dispatch({ type: "leave" })}>
                <Icon name={cfg.mode === "car" ? "car" : "train"} />出门{cfg.mode === "car" ? "，开车" : "，坐地铁"}
              </button>
              {!local.bag.includes("laptop") && <span className="cm-muted">先把电脑装进包</span>}
            </div>
          </div>
        )}

        {local.leaving && (
          <div className={`cm-scene cm-transit cm-transit-${cfg.mode}`} aria-live="polite">
            <div className="cm-window" aria-hidden="true"><span className="cm-skyline" /></div>
            <div className="cm-route" aria-hidden="true">
              <span><Icon name="home" size={14} />家</span>
              <span className="cm-route-line"><i /></span>
              <span><Icon name="slides" size={14} />公司</span>
            </div>
            <p className="cm-transit-note">
              {cfg.mode === "car" ? `背包放副驾 · ${kg} kg` : `背着 ${kg} kg 站着 · 车厢里拿不出电脑`}
            </p>
          </div>
        )}

        {place === "meeting" && (
          <div className="cm-scene cm-room">
            <div className="cm-wall" aria-hidden="true">
              <span className="cm-board">{local.laptopOut && <strong>{local.slide < SLIDES ? SLIDE_TITLES[local.slide] : "谢谢"}</strong>}</span>
            </div>
            <div className="cm-socket-slot">{socketButton}</div>
            <div className="cm-table" aria-hidden="true" />
            <div className="cm-floor">
              {bagButton("从背包里拿出电脑")}
              {local.laptopOut && (
                <Laptop label="示意电脑">
                  <div className="os-desktop os-wall-cool">
                    <section className="os-window cm-slides" aria-label="方案汇报">
                      <header className="os-title"><Icon name="slides" size={12} />方案汇报 — 演示<span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span></header>
                      <div className="cm-slide">
                        {local.slide < SLIDES ? (
                          <>
                            <span className="cm-slide-no">{local.slide + 1} / {SLIDES}</span>
                            <strong>{SLIDE_TITLES[local.slide]}</strong>
                            <span className="cm-slide-lines" aria-hidden="true"><i /><i /><i className="short" /></span>
                          </>
                        ) : (
                          <strong className="os-ok"><Icon name="check" size={16} />讲完了</strong>
                        )}
                      </div>
                      <footer className="cm-slide-foot">
                        <span className="os-muted">每页约 {SLIDE_MIN} 分钟</span>
                        <button type="button" className={`os-btn os-btn-primary${nx("next")}`} disabled={disabled || local.slide >= SLIDES} onClick={() => dispatch({ type: "next_slide" })}>下一页</button>
                      </footer>
                    </section>
                    <Taskbar time={clockText(local.clock)}>{tray}</Taskbar>
                  </div>
                </Laptop>
              )}
            </div>
            {local.slide >= SLIDES && (
              <div className="cm-exit">
                {cfg.hasCafe && <button type="button" className={`btn btn-primary${nx("exit")}`} disabled={disabled} onClick={() => dispatch({ type: "go_cafe" })}><Icon name="coffee" />去咖啡厅接着干</button>}
                <button type="button" className={`btn${cfg.hasCafe ? "" : ` btn-primary${nx("exit")}`}`} disabled={disabled} onClick={() => dispatch({ type: "wrap_up" })}><Icon name="home" />收工回家</button>
              </div>
            )}
          </div>
        )}

        {place === "cafe" && !local.seat && (
          <div className="cm-scene cm-cafe cm-seats">
            {(["window", "wall"] as const).map((seat) => (
              <button key={seat} type="button" className={`cm-seat cm-seat-${seat}${nx("seat")}`} disabled={disabled} onClick={() => dispatch({ type: "seat", seat })}>
                <span className="cm-seat-art" aria-hidden="true">{seat === "window" ? <span className="cm-seat-pane" /> : <span className="cm-socket-face"><i /><i /></span>}</span>
                <strong>{seat === "window" ? "窗边" : "墙边"}</strong>
                <span className="cm-muted">{seat === "window" ? "光线好，没有插座" : "有插座，人多一点"}</span>
              </button>
            ))}
          </div>
        )}

        {place === "cafe" && local.seat && (
          <div className="cm-scene cm-cafe">
            <div className="cm-wall" aria-hidden="true">{local.seat === "window" && <span className="cm-cafe-window" />}</div>
            {socket && <div className="cm-socket-slot">{socketButton}</div>}
            <div className="cm-table" aria-hidden="true" />
            <div className="cm-floor">
              {bagButton("从背包里拿出电脑")}
              {local.laptopOut && (
                <Laptop label="示意电脑">
                  <div className="os-desktop os-wall-warm">
                    <section className="os-window cm-work" aria-label="周报">
                      <header className="os-title"><Icon name="doc" size={12} />周报 — 文档<span className="os-title-actions" aria-hidden="true"><i /><i /><i /></span></header>
                      <div className="os-doc-body" aria-hidden="true"><b /><i /><i /><i className="short" /><b /><i /><i className="short" /></div>
                    </section>
                    <Taskbar time={clockText(local.clock)}>{tray}</Taskbar>
                  </div>
                </Laptop>
              )}
            </div>
            {local.laptopOut && (
              <section className="sim-card cm-plan" aria-label="在这里待多久">
                <header><strong>在这里待多久？</strong><span className="cm-muted">你设定在外约 {cfg.hoursOutside} 小时</span></header>
                <label className={`cm-range${nx("hours")}`}>
                  <input type="range" min={1} max={maxCafeHours(cfg)} step={1} value={hours} disabled={disabled} onChange={(e) => dispatch({ type: "hours", hours: Number(e.target.value) })} aria-label="在咖啡厅待几个小时" />
                  <span><b>{hours}</b> 小时 · 到 {clockText(local.clock + hours * 60)}</span>
                </label>
                <CafeForecast battery={local.battery} hours={hours} plugged={local.plugged} />
                <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => dispatch({ type: "wrap_up" })}><Icon name="home" />收工回家</button>
              </section>
            )}
          </div>
        )}

        {place === "evening" && <Review local={local} cfg={cfg} server={server} />}

        {dnd.drag && (
          <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true"><ItemArt item={dnd.drag.item} /></div>
        )}
      </div>
      <div className="stage-tools">
        <span className="muted small">重量、耗电、充电速度都是虚拟设定，用来体会一天的安排，不代表任何型号的重量与续航。</span>
        <ReplayTools replay={replay} disabled={disabled} onReset={() => setLocal(cmInitial)} label="换个选择，再过一遍" />
      </div>
    </div>
  );
}

/** 咖啡厅时长的预估：按虚拟设定，电量会走到哪里、会不会提前耗尽。 */
function CafeForecast({ battery, hours, plugged }: { battery: number; hours: number; plugged: boolean }) {
  const end = drain(battery, hours * 60, RATE.office, plugged);
  const left = hoursLeft(battery, RATE.office, plugged);
  const dies = left !== null && left < hours;
  return (
    <div className={`cm-forecast${dies ? " is-bad" : ""}`}>
      <div className="cm-forecast-bar" aria-hidden="true">
        <i className="now" style={{ width: `${battery}%` }} />
        <i className="end" style={{ width: `${end}%` }} />
      </div>
      <p>{plugged ? `插着电：收工时约 ${Math.round(end)}%` : dies ? `大约 ${left!.toFixed(1)} 小时后没电，收工前就关机了` : `收工时约剩 ${Math.round(end)}%`}</p>
      <p className="cm-muted">轻办公耗电 {RATE.office}%/时，插电充电 {RATE.charge}%/时（虚拟设定）</p>
    </div>
  );
}

function Review({ local, cfg, server }: { local: CmLocal; cfg: CmConfig; server: CmState }) {
  const bag = bagOf(server, local);
  const rows: { time: string; icon: IconName; text: string; bat?: number; plugged?: boolean }[] = [];
  if (local.log.length) {
    rows.push({ time: clockText(CM_START), icon: "bag", text: `出门：背包 ${bagKg(bag)} kg（${bag.map((i) => ITEMS.find((x) => x.id === i)!.label).join("、")}）` });
    for (const seg of local.log) {
      rows.push({
        time: `${Math.round(seg.minutes / 6) / 10} 小时`,
        icon: seg.place === "meeting" ? "slides" : "coffee",
        text: seg.place === "meeting" ? "会议室讲方案" : "咖啡厅办公",
        bat: seg.battery,
        plugged: seg.plugged,
      });
    }
    rows.push({ time: clockText(local.clock), icon: "home", text: "收工回家" });
  }
  return (
    <div className="cm-scene cm-dusk">
      <section className="cm-review" aria-label="这一天的回顾">
        <h3>这一天</h3>
        {rows.length > 0 && (
          <ol className="cm-timeline">
            {rows.map((r, i) => (
              <li key={i}>
                <span className="cm-tl-time">{r.time}</span>
                <span className="cm-tl-icon"><Icon name={r.icon} size={14} /></span>
                <span className="cm-tl-text">{r.text}</span>
                {r.bat !== undefined && <span className="cm-tl-bat"><Battery value={r.bat} charging={!!r.plugged} />{r.plugged ? "插电" : "电池"}</span>}
              </li>
            ))}
          </ol>
        )}
        <h3>去看资料时，重点核对</h3>
        <ul className="cm-advice">{cmReview(local, cfg, server).map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
    </div>
  );
}
