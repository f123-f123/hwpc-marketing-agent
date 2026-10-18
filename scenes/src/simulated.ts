import type { DeviceBinding, EvidenceItem, SceneConfig, SceneDefinition } from "./types";

/** 项目自带的"示意设备"证据条目：说明这些设备是虚拟的，不是任何产品。 */
export const SIMULATED_EVIDENCE: EvidenceItem = {
  evidenceId: "ev-simulated-device",
  level: "guidance",
  title: "虚拟示意设备（本项目自带）",
  origin: "project",
  locator: "scenes/src/definitions（simulatedPresets）",
  statement: "仅用于演示操作流程，不对应任何真实型号，不构成产品功能结论",
};

/**
 * 只含虚拟示意设备的配置。用于开发、测试和"通用体验"。
 * 真实产品与组合必须等 A 的证据绑定后由 B 生成配置；这里不会硬编码任何产品参数。
 */
export function simulatedConfig(def: SceneDefinition): SceneConfig {
  const bindings: DeviceBinding[] = def.simulatedPresets.map((p) => ({
    bindingId: `sim:${p.presetId}`,
    roleId: p.roleId,
    label: p.label,
    source: "simulated",
    presetId: p.presetId,
    capabilities: Object.fromEntries(Object.entries(p.capabilities).map(([k, v]) => [k, { value: v, evidenceIds: [SIMULATED_EVIDENCE.evidenceId] }])),
  }));
  return { sceneId: def.sceneId, sceneVersion: def.version, bindings, evidence: [SIMULATED_EVIDENCE] };
}
