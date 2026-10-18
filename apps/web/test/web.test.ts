import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api/client";
import { nextStep, type StageInput } from "../src/lib/stage";

/** 只填 nextStep 用到的字段。 */
function stage(over: {
  run?: StageInput["run"];
  status?: StageInput["needs"]["status"];
  confirmable?: boolean;
  blockers?: string[];
  canCompose?: boolean;
  plan?: boolean;
  questions?: number;
}): StageInput {
  return {
    run: over.run ?? { state: "idle" },
    needs: {
      status: over.status ?? "collecting",
      summary: { confirmable: over.confirmable ?? false, blockers: over.blockers ?? [] },
    },
    plan: { canCompose: over.canCompose ?? false, current: over.plan ? { needsReview: false } : undefined },
    conversation: { openQuestions: Array.from({ length: over.questions ?? 0 }, () => ({})) },
  } as unknown as StageInput;
}

describe("nextStep", () => {
  it("出错优先于其他一切", () => {
    const s = nextStep(stage({ run: { state: "failed", error: { code: "x", message: "引擎超时" } }, status: "awaiting_confirmation", confirmable: true }));
    expect(s).toMatchObject({ action: "resume", detail: "引擎超时", enabled: true });
  });

  it("待确认但有阻塞时，按钮不可用并说明原因", () => {
    const s = nextStep(stage({ status: "awaiting_confirmation", confirmable: false, blockers: ["预算未知"] }));
    expect(s).toMatchObject({ action: "confirm", enabled: false });
    expect(s.detail).toContain("预算未知");
  });

  it("需求变化后要求重新确认", () => {
    expect(nextStep(stage({ status: "changed_since_confirmation", confirmable: true })).cta).toBe("重新确认需求");
  });

  it("已确认未组装 → 生成方案；已有方案 → 去体验", () => {
    expect(nextStep(stage({ status: "confirmed", canCompose: true })).action).toBe("compose");
    expect(nextStep(stage({ status: "confirmed", canCompose: true, plan: true })).action).toBe("experience");
  });

  it("沟通中：有问题先回答，没有就继续聊", () => {
    expect(nextStep(stage({ questions: 2 })).action).toBe("answer");
    expect(nextStep(stage({})).action).toBe("talk");
  });
});

describe("api 客户端的错误处理", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("代理返回 HTML 错误页时给出可读提示，而不是 JSON 解析异常", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 })));
    const err = await api.get("abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("无法连接本地服务");
    expect((err as ApiError).status).toBe(502);
  });

  it("网络不通时同样给出可读提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api.get("abc").catch((e: unknown) => e);
    expect((err as ApiError).message).toContain("无法连接本地服务");
  });

  it("业务错误保留服务端的 code 与文案", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "not_found", message: "会话 abc 不存在" } }, { status: 404 })));
    const err = (await api.get("abc").catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "会话 abc 不存在" });
  });

  it("响应与契约不符时报出版本不一致", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hello: "world" })));
    await expect(api.get("abc")).rejects.toThrow("契约不一致");
  });
});
