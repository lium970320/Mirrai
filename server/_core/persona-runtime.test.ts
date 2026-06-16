import { describe, expect, it } from "vitest";
import {
  extractPersonaRuntimeForStorage,
  getPersonaRuntimeState,
  getProactiveMessageConfig,
  getProactiveMessageSettings,
  mergePersonaRuntimeIntoPersonaData,
  stripPersonaRuntimeFields,
  withPersonaRuntimeDiagnostics,
  withPersonaRuntimeLifeState,
  withProactiveMessageConfig,
  withProactiveMessageRuntime,
} from "./persona-runtime";

describe("persona runtime state", () => {
  it("reads canonical runtime first while keeping legacy personaData compatibility", () => {
    const personaData = {
      runtimeLifeState: { status: "legacy_root" },
      runtimeDiagnostics: { source: "legacy_root" },
      proactiveMessages: {
        enabled: true,
        times: ["18:00"],
        stylePrompt: "legacy style",
        randomizedSchedule: { source: "legacy_root_schedule" },
        lastSent: { "18:00": "2026-06-07" },
      },
      personaRuntime: {
        runtimeLifeState: { status: "canonical" },
        runtimeDiagnostics: { source: "canonical" },
        proactiveMessages: {
          randomizedSchedule: { source: "canonical_schedule" },
        },
      },
    };

    expect(getProactiveMessageConfig(personaData)).toEqual({
      enabled: true,
      times: ["18:00"],
      stylePrompt: "legacy style",
    });
    expect(getPersonaRuntimeState(personaData)).toEqual({
      runtimeLifeState: { status: "canonical" },
      runtimeDiagnostics: { source: "canonical" },
      runtimeInnerState: null,
      proactiveMessages: {
        randomizedSchedule: { source: "canonical_schedule" },
        lastSent: { "18:00": "2026-06-07" },
        ambientPresence: undefined,
      },
    });
    expect(getProactiveMessageSettings(personaData)).toEqual({
      enabled: true,
      times: ["18:00"],
      stylePrompt: "legacy style",
      randomizedSchedule: { source: "canonical_schedule" },
      lastSent: { "18:00": "2026-06-07" },
      ambientPresence: undefined,
    });
  });

  it("writes proactive runtime to personaRuntime and leaves only user config in proactiveMessages", () => {
    const next = withProactiveMessageRuntime({
      proactiveMessages: {
        enabled: true,
        times: ["08:00", "08:00"],
        stylePrompt: "natural",
        randomizedSchedule: { old: true },
        lastSent: { "08:00": "2026-06-07" },
      },
      profileSections: {
        runtime: {
          proactiveMessages: {
            ambientPresence: { old: true },
          },
        },
      },
    }, {
      randomizedSchedule: { next: true },
      lastSent: { "08:00": "2026-06-08" },
    });

    expect(next.proactiveMessages).toEqual({
      enabled: true,
      times: ["08:00", "08:00"],
      stylePrompt: "natural",
    });
    expect((next.profileSections as any).runtime.proactiveMessages).toEqual({});
    expect((next.personaRuntime as any).proactiveMessages).toEqual({
      randomizedSchedule: { next: true },
      lastSent: { "08:00": "2026-06-08" },
    });
  });

  it("keeps proactive config writes separate from runtime scheduling state", () => {
    const next = withProactiveMessageConfig({
      proactiveMessages: {
        enabled: false,
        times: ["18:00"],
        stylePrompt: "old",
        randomizedSchedule: { shouldBeRemoved: true },
      },
      personaRuntime: {
        proactiveMessages: {
          randomizedSchedule: { keep: true },
        },
      },
    }, {
      enabled: true,
      times: ["21:00", "21:00", ""],
      stylePrompt: "new",
    });

    expect(next.proactiveMessages).toEqual({
      enabled: true,
      times: ["21:00"],
      stylePrompt: "new",
    });
    expect((next.personaRuntime as any).proactiveMessages.randomizedSchedule).toEqual({ keep: true });
  });

  it("writes life state and diagnostics to canonical runtime and removes legacy roots", () => {
    const withLife = withPersonaRuntimeLifeState({
      runtimeLifeState: { status: "legacy" },
      runtimeDiagnostics: { source: "legacy" },
      profileSections: {
        runtime: {
          runtimeLifeState: { status: "profile_legacy" },
          runtimeDiagnostics: { source: "profile_legacy" },
        },
      },
    }, {
      status: "drowsy_awake",
      startedAt: "2026-06-08T00:00:00.000Z",
      until: "2026-06-08T00:20:00.000Z",
      reason: "wake_message",
    });
    const withDiagnostics = withPersonaRuntimeDiagnostics(withLife, { turnPlan: { intent: "chat" } });

    expect(withDiagnostics.runtimeLifeState).toBeUndefined();
    expect(withDiagnostics.runtimeDiagnostics).toBeUndefined();
    expect((withDiagnostics.profileSections as any).runtime.runtimeLifeState).toBeUndefined();
    expect((withDiagnostics.profileSections as any).runtime.runtimeDiagnostics).toBeUndefined();
    expect(getPersonaRuntimeState(withDiagnostics).runtimeLifeState).toMatchObject({
      status: "drowsy_awake",
      reason: "wake_message",
    });
    expect(getPersonaRuntimeState(withDiagnostics).runtimeDiagnostics).toEqual({
      turnPlan: { intent: "chat" },
    });
  });

  it("extracts runtime state for storage while stripping personaData runtime fields", () => {
    const personaData = {
      personality: "steady",
      runtimeLifeState: { status: "legacy_root" },
      runtimeDiagnostics: { source: "legacy_root" },
      proactiveMessages: {
        enabled: true,
        times: ["18:00"],
        stylePrompt: "soft",
        randomizedSchedule: { legacy: true },
        lastSent: { "18:00": "2026-06-07" },
      },
      profileSections: {
        runtime: {
          runtimeLifeState: { status: "profile_legacy" },
          runtimeDiagnostics: { source: "profile_legacy" },
          proactiveMessages: {
            ambientPresence: { count: 1 },
          },
        },
      },
      personaRuntime: {
        runtimeLifeState: { status: "canonical" },
        runtimeDiagnostics: { source: "canonical" },
        proactiveMessages: {
          randomizedSchedule: { canonical: true },
        },
      },
    };

    const extracted = extractPersonaRuntimeForStorage(personaData);

    expect(extracted.hasRuntimePatch).toBe(true);
    expect(extracted.runtimeLifeState).toEqual({ status: "canonical" });
    expect(extracted.runtimeDiagnostics).toEqual({ source: "canonical" });
    expect(extracted.proactiveRuntime).toEqual({
      randomizedSchedule: { canonical: true },
      lastSent: { "18:00": "2026-06-07" },
      ambientPresence: { count: 1 },
    });
    expect(extracted.personaData).toEqual({
      personality: "steady",
      proactiveMessages: {
        enabled: true,
        times: ["18:00"],
        stylePrompt: "soft",
      },
      profileSections: {
        runtime: {
          proactiveMessages: {},
        },
      },
    });
  });

  it("tracks explicit runtime patches without making patch metadata enumerable", () => {
    const patched = withPersonaRuntimeDiagnostics(
      withProactiveMessageRuntime({ proactiveMessages: { enabled: true, times: ["09:00"] } }, {
        lastSent: { "09:00": "2026-06-08" },
      }),
      { turnPlan: { intent: "reply" } },
    );

    expect(Object.keys(patched)).not.toContain("__personaRuntimePatch");

    const extracted = extractPersonaRuntimeForStorage(patched);
    expect(extracted.hasRuntimePatch).toBe(true);
    expect(extracted.personaData).toEqual({
      proactiveMessages: {
        enabled: true,
        times: ["09:00"],
      },
    });
    expect(extracted.runtimeDiagnostics).toEqual({ turnPlan: { intent: "reply" } });
    expect(extracted.proactiveRuntime).toEqual({ lastSent: { "09:00": "2026-06-08" } });
  });

  it("merges runtime table rows back into canonical personaRuntime", () => {
    const stripped = stripPersonaRuntimeFields({
      proactiveMessages: {
        enabled: true,
        times: ["22:00"],
        randomizedSchedule: { old: true },
      },
      runtimeLifeState: { status: "legacy" },
    });

    const merged = mergePersonaRuntimeIntoPersonaData(stripped, {
      runtimeLifeState: { status: "awake" },
      runtimeDiagnostics: { platform: "qq" },
      proactiveRuntime: {
        randomizedSchedule: { day: "2026-06-08" },
      },
    });

    expect(merged.runtimeLifeState).toBeUndefined();
    expect(merged.proactiveMessages).toEqual({
      enabled: true,
      times: ["22:00"],
    });
    expect(merged.personaRuntime).toEqual({
      runtimeLifeState: { status: "awake" },
      runtimeDiagnostics: { platform: "qq" },
      proactiveMessages: {
        randomizedSchedule: { day: "2026-06-08" },
      },
    });
    expect(getPersonaRuntimeState(merged)).toMatchObject({
      runtimeLifeState: { status: "awake" },
      runtimeDiagnostics: { platform: "qq" },
      proactiveMessages: {
        randomizedSchedule: { day: "2026-06-08" },
      },
    });
  });
});
