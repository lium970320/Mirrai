import { describe, expect, it } from "vitest";
import {
  getWechatSyncCircuitBreakerReason,
  isUsableMemoryCardContent,
  isWechat4uPuppet,
} from "./sync-circuit-breaker";

describe("wechat sync circuit breaker", () => {
  it("detects wechat4u 1102 sync assertions", () => {
    const error = new Error("AssertionError [ERR_ASSERTION]: '1102' == 0");

    expect(getWechatSyncCircuitBreakerReason(error)).toBe("wechat4u_sync_retcode_1102");
  });

  it("detects login http 400 assertions", () => {
    const error = new Error("AssertionError [ERR_ASSERTION]: 400 != 400");

    expect(getWechatSyncCircuitBreakerReason(error)).toBe("wechat4u_login_http_400");
  });

  it("detects consecutive sync failures", () => {
    expect(getWechatSyncCircuitBreakerReason(new Error("连续4次同步失败，5s后尝试重启"))).toBe(
      "wechat4u_consecutive_sync_failure",
    );
  });

  it("detects stalled sync polling", () => {
    expect(getWechatSyncCircuitBreakerReason(new Error("状态同步超过90s未响应，5s后尝试重启"))).toBe(
      "wechat4u_sync_stalled",
    );
  });

  it("does not treat generic network errors as circuit breaker failures", () => {
    expect(getWechatSyncCircuitBreakerReason(new Error("read ECONNRESET"))).toBeNull();
  });

  it("matches wechat4u puppet names", () => {
    expect(isWechat4uPuppet("wechaty-puppet-wechat4u")).toBe(true);
    expect(isWechat4uPuppet("wechaty-puppet-padlocal")).toBe(false);
  });

  it("ignores empty memory-card files", () => {
    expect(isUsableMemoryCardContent("{}")).toBe(false);
    expect(isUsableMemoryCardContent("")).toBe(false);
    expect(isUsableMemoryCardContent('{"payload":{"id":"abc"}}')).toBe(true);
  });
});
