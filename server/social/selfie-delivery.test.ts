import { describe, expect, it } from "vitest";
import { pickSelfieDeliveryLine } from "./selfie-delivery";

describe("pickSelfieDeliveryLine", () => {
  it("返回对应 kind 的非空交付语", () => {
    const line = pickSelfieDeliveryLine("environment", "c-env", () => 0);
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(0);
  });

  it("避免与上一句连续重复（同 contact 同 kind）", () => {
    const a = pickSelfieDeliveryLine("selfie", "c-dup", () => 0);
    const b = pickSelfieDeliveryLine("selfie", "c-dup", () => 0);
    expect(b).not.toBe(a);
  });

  it("自拍 / 环境用各自话术池", () => {
    const env = pickSelfieDeliveryLine("environment", "c-k", () => 0);
    const selfie = pickSelfieDeliveryLine("selfie", "c-k2", () => 0);
    expect(env).not.toBe(selfie);
  });
});
