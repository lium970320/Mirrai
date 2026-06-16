import { describe, expect, it } from "vitest";
import { computeReplyLatencyMs } from "./reply-latency";

describe("reply latency (pure computation)", () => {
  it("scales within the availability range by the random value", () => {
    expect(computeReplyLatencyMs("brief", () => 0)).toBe(4_000);
    expect(computeReplyLatencyMs("brief", () => 0.5)).toBe(9_000);
    expect(computeReplyLatencyMs("brief", () => 1)).toBe(14_000);
  });

  it("returns 0 for sleep/unknown availability", () => {
    expect(computeReplyLatencyMs("silent_unless_urgent", () => 0.9)).toBe(0);
    expect(computeReplyLatencyMs("not-a-real-availability", () => 0.9)).toBe(0);
  });

  it("keeps open (idle) latency small", () => {
    expect(computeReplyLatencyMs("open", () => 1)).toBeLessThanOrEqual(2_500);
  });
});
