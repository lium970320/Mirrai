import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { getQqBotStatus, sendQqText } from "./onebot-client";

function onebotResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OneBot text delivery", () => {
  it("retries one transient QQ kernel timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(onebotResponse({ status: "failed", retcode: 1200, message: "Timeout: sendMsg" }))
      .mockResolvedValueOnce(onebotResponse({ status: "ok", retcode: 0, data: { message_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = sendQqText("qq:private:123", "测试回复");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(onebotResponse({}, false, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendQqText("qq:private:123", "测试回复")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the bot offline when the API responds but QQ is disconnected", async () => {
    const previousEnabled = ENV.qqEnabled;
    ENV.qqEnabled = true;
    const fetchMock = vi.fn().mockResolvedValue(
      onebotResponse({ status: "ok", retcode: 0, data: { online: false, good: true } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await getQqBotStatus().finally(() => {
      ENV.qqEnabled = previousEnabled;
    });

    expect(status.status).toBe("error");
    expect(status.lastError).toContain("offline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a degraded bot when online status is OK but the friend list is empty", async () => {
    const previousEnabled = ENV.qqEnabled;
    ENV.qqEnabled = true;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(onebotResponse({ status: "ok", retcode: 0, data: { online: true, good: true } }))
      .mockResolvedValueOnce(onebotResponse({ status: "ok", retcode: 0, data: { user_id: 3321802943, nickname: "bot" } }))
      .mockResolvedValueOnce(onebotResponse({ status: "ok", retcode: 0, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const status = await getQqBotStatus().finally(() => {
      ENV.qqEnabled = previousEnabled;
    });

    expect(status.status).toBe("error");
    expect(status.lastError).toContain("friend list is empty");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
