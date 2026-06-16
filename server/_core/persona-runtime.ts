type UnknownRecord = Record<string, unknown>;

export const PERSONA_RUNTIME_KEY = "personaRuntime";
export const PERSONA_RUNTIME_PATCH_KEY = "__personaRuntimePatch";

const PROACTIVE_RUNTIME_KEYS = ["randomizedSchedule", "lastSent", "ambientPresence"] as const;

export type ProactiveMessageConfig = {
  enabled: boolean;
  times: string[];
  stylePrompt: string;
};

export type ProactiveMessageRuntime = {
  randomizedSchedule?: unknown;
  lastSent?: unknown;
  ambientPresence?: unknown;
};

export type ProactiveMessageSettings = ProactiveMessageConfig & ProactiveMessageRuntime;

export type PersonaRuntimeState = {
  runtimeLifeState: unknown | null;
  runtimeDiagnostics: unknown | null;
  runtimeInnerState: unknown | null;
  proactiveMessages: ProactiveMessageRuntime;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clonePersonaData(personaData: unknown): UnknownRecord {
  return isRecord(personaData) ? { ...personaData } : {};
}

function markRuntimePatch(data: UnknownRecord, patch: UnknownRecord): UnknownRecord {
  const existing = cloneRecord((data as any)[PERSONA_RUNTIME_PATCH_KEY]);
  Object.defineProperty(data, PERSONA_RUNTIME_PATCH_KEY, {
    value: { ...existing, ...patch },
    enumerable: false,
    configurable: true,
  });
  return data;
}

function cloneRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? { ...value } : {};
}

function firstDefined(...values: unknown[]) {
  return values.find(value => value !== undefined && value !== null);
}

function profileRuntime(data: UnknownRecord): UnknownRecord {
  const profileSections = cloneRecord(data.profileSections);
  return cloneRecord(profileSections.runtime);
}

function profileProactiveMessages(data: UnknownRecord): UnknownRecord {
  return cloneRecord(profileRuntime(data).proactiveMessages);
}

function rootProactiveMessages(data: UnknownRecord): UnknownRecord {
  return cloneRecord(data.proactiveMessages);
}

function runtimeContainer(data: UnknownRecord): UnknownRecord {
  return cloneRecord(data[PERSONA_RUNTIME_KEY]);
}

function runtimeProactiveMessages(data: UnknownRecord): UnknownRecord {
  return cloneRecord(runtimeContainer(data).proactiveMessages);
}

function normalizeTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => typeof item === "string" ? item.trim() : "")
      .filter(Boolean),
  ));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stripProactiveRuntimeFields(value: unknown): UnknownRecord {
  const next = cloneRecord(value);
  for (const key of PROACTIVE_RUNTIME_KEYS) {
    delete next[key];
  }
  return next;
}

function removeProfileRuntimeField(data: UnknownRecord, field: string) {
  if (!isRecord(data.profileSections)) return;
  const profileSections = { ...data.profileSections };
  if (!isRecord(profileSections.runtime)) {
    data.profileSections = profileSections;
    return;
  }
  const runtime = { ...profileSections.runtime };
  delete runtime[field];
  profileSections.runtime = runtime;
  data.profileSections = profileSections;
}

function removeProfileProactiveRuntimeFields(data: UnknownRecord) {
  if (!isRecord(data.profileSections)) return;
  const profileSections = { ...data.profileSections };
  if (!isRecord(profileSections.runtime)) {
    data.profileSections = profileSections;
    return;
  }
  const runtime = { ...profileSections.runtime };
  if (isRecord(runtime.proactiveMessages)) {
    runtime.proactiveMessages = stripProactiveRuntimeFields(runtime.proactiveMessages);
  }
  profileSections.runtime = runtime;
  data.profileSections = profileSections;
}

function compactRuntime(runtime: UnknownRecord): UnknownRecord {
  const next = { ...runtime };
  if (isRecord(next.proactiveMessages) && Object.keys(next.proactiveMessages).length === 0) {
    delete next.proactiveMessages;
  }
  return next;
}

function setRuntimeContainer(data: UnknownRecord, runtime: UnknownRecord): UnknownRecord {
  const compacted = compactRuntime(runtime);
  if (Object.keys(compacted).length > 0) {
    data[PERSONA_RUNTIME_KEY] = compacted;
  } else {
    delete data[PERSONA_RUNTIME_KEY];
  }
  return data;
}

export function getPersonaRuntimeState(personaData: unknown): PersonaRuntimeState {
  const data = clonePersonaData(personaData);
  const runtime = runtimeContainer(data);
  const profile = profileRuntime(data);
  const rootProactive = rootProactiveMessages(data);
  const profileProactive = profileProactiveMessages(data);
  const runtimeProactive = runtimeProactiveMessages(data);

  return {
    runtimeLifeState: firstDefined(
      runtime.runtimeLifeState,
      data.runtimeLifeState,
      profile.runtimeLifeState,
    ) ?? null,
    runtimeDiagnostics: firstDefined(
      runtime.runtimeDiagnostics,
      data.runtimeDiagnostics,
      profile.runtimeDiagnostics,
    ) ?? null,
    runtimeInnerState: firstDefined(
      runtime.runtimeInnerState,
      data.runtimeInnerState,
      profile.runtimeInnerState,
    ) ?? null,
    proactiveMessages: {
      randomizedSchedule: firstDefined(
        runtimeProactive.randomizedSchedule,
        rootProactive.randomizedSchedule,
        profileProactive.randomizedSchedule,
      ),
      lastSent: firstDefined(
        runtimeProactive.lastSent,
        rootProactive.lastSent,
        profileProactive.lastSent,
      ),
      ambientPresence: firstDefined(
        runtimeProactive.ambientPresence,
        rootProactive.ambientPresence,
        profileProactive.ambientPresence,
      ),
    },
  };
}

export function getProactiveMessageConfig(personaData: unknown): ProactiveMessageConfig {
  const data = clonePersonaData(personaData);
  const rootProactive = rootProactiveMessages(data);
  const profileProactive = profileProactiveMessages(data);
  return {
    enabled: Boolean(firstDefined(rootProactive.enabled, profileProactive.enabled)),
    times: normalizeTimes(firstDefined(rootProactive.times, profileProactive.times)),
    stylePrompt: stringValue(firstDefined(rootProactive.stylePrompt, profileProactive.stylePrompt)),
  };
}

export function getProactiveMessageSettings(personaData: unknown): ProactiveMessageSettings {
  const config = getProactiveMessageConfig(personaData);
  const runtime = getPersonaRuntimeState(personaData).proactiveMessages;
  return {
    ...config,
    ...runtime,
  };
}

export function withProactiveMessageConfig(
  personaData: unknown,
  patch: Partial<ProactiveMessageConfig>,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  const proactive = stripProactiveRuntimeFields(data.proactiveMessages);
  if (patch.enabled !== undefined) proactive.enabled = patch.enabled;
  if (patch.times !== undefined) proactive.times = normalizeTimes(patch.times);
  if (patch.stylePrompt !== undefined) proactive.stylePrompt = patch.stylePrompt;
  data.proactiveMessages = proactive;
  return data;
}

export function withProactiveMessageRuntime(
  personaData: unknown,
  patch: Partial<ProactiveMessageRuntime>,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  const runtime = runtimeContainer(data);
  const proactiveRuntime = runtimeProactiveMessages(data);
  for (const key of PROACTIVE_RUNTIME_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined || value === null) {
      delete proactiveRuntime[key];
    } else {
      proactiveRuntime[key] = value;
    }
  }
  runtime.proactiveMessages = proactiveRuntime;
  if (isRecord(data.proactiveMessages)) {
    data.proactiveMessages = stripProactiveRuntimeFields(data.proactiveMessages);
  }
  removeProfileProactiveRuntimeFields(data);
  return markRuntimePatch(setRuntimeContainer(data, runtime), {
    proactiveMessages: { ...patch },
  });
}

export function withPersonaRuntimeLifeState(
  personaData: unknown,
  runtimeLifeState: unknown | null,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  const runtime = runtimeContainer(data);
  if (runtimeLifeState === undefined || runtimeLifeState === null) {
    delete runtime.runtimeLifeState;
  } else {
    runtime.runtimeLifeState = runtimeLifeState;
  }
  delete data.runtimeLifeState;
  removeProfileRuntimeField(data, "runtimeLifeState");
  return markRuntimePatch(setRuntimeContainer(data, runtime), { runtimeLifeState });
}

export function withPersonaRuntimeDiagnostics(
  personaData: unknown,
  runtimeDiagnostics: unknown | null,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  const runtime = runtimeContainer(data);
  if (runtimeDiagnostics === undefined || runtimeDiagnostics === null) {
    delete runtime.runtimeDiagnostics;
  } else {
    runtime.runtimeDiagnostics = runtimeDiagnostics;
  }
  delete data.runtimeDiagnostics;
  removeProfileRuntimeField(data, "runtimeDiagnostics");
  return markRuntimePatch(setRuntimeContainer(data, runtime), { runtimeDiagnostics });
}

export function withPersonaRuntimeInnerState(
  personaData: unknown,
  runtimeInnerState: unknown | null,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  const runtime = runtimeContainer(data);
  if (runtimeInnerState === undefined || runtimeInnerState === null) {
    delete runtime.runtimeInnerState;
  } else {
    runtime.runtimeInnerState = runtimeInnerState;
  }
  delete data.runtimeInnerState;
  removeProfileRuntimeField(data, "runtimeInnerState");
  return markRuntimePatch(setRuntimeContainer(data, runtime), { runtimeInnerState });
}

export function getPersonaRuntimePatch(personaData: unknown): UnknownRecord {
  return isRecord(personaData) ? cloneRecord((personaData as any)[PERSONA_RUNTIME_PATCH_KEY]) : {};
}

export function stripPersonaRuntimeFields(personaData: unknown): UnknownRecord {
  const data = clonePersonaData(personaData);
  delete data[PERSONA_RUNTIME_KEY];
  delete data[PERSONA_RUNTIME_PATCH_KEY];
  delete data.runtimeLifeState;
  delete data.runtimeDiagnostics;
  delete data.runtimeInnerState;
  if (isRecord(data.proactiveMessages)) {
    data.proactiveMessages = stripProactiveRuntimeFields(data.proactiveMessages);
  }
  removeProfileRuntimeField(data, "runtimeLifeState");
  removeProfileRuntimeField(data, "runtimeDiagnostics");
  removeProfileRuntimeField(data, "runtimeInnerState");
  removeProfileProactiveRuntimeFields(data);
  return data;
}

function compactProactiveRuntime(value: ProactiveMessageRuntime): ProactiveMessageRuntime {
  const next: ProactiveMessageRuntime = {};
  for (const key of PROACTIVE_RUNTIME_KEYS) {
    const item = value[key];
    if (item !== undefined && item !== null) next[key] = item;
  }
  return next;
}

function hasProactiveRuntimeFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return PROACTIVE_RUNTIME_KEYS.some(key => value[key] !== undefined && value[key] !== null);
}

export function extractPersonaRuntimeForStorage(personaData: unknown): {
  personaData: UnknownRecord;
  runtimeLifeState?: unknown | null;
  runtimeDiagnostics?: unknown | null;
  runtimeInnerState?: unknown | null;
  proactiveRuntime?: ProactiveMessageRuntime | null;
  hasRuntimePatch: boolean;
} {
  const data = clonePersonaData(personaData);
  const profile = profileRuntime(data);
  const state = getPersonaRuntimeState(personaData);
  const patch = getPersonaRuntimePatch(personaData);
  const hasPatch = Object.keys(patch).length > 0
    || isRecord(data[PERSONA_RUNTIME_KEY])
    || data.runtimeLifeState !== undefined
    || data.runtimeDiagnostics !== undefined
    || data.runtimeInnerState !== undefined
    || profile.runtimeLifeState !== undefined
    || profile.runtimeDiagnostics !== undefined
    || profile.runtimeInnerState !== undefined
    || hasProactiveRuntimeFields(data.proactiveMessages)
    || hasProactiveRuntimeFields(profile.proactiveMessages);
  const runtimePatch = patch as {
    runtimeLifeState?: unknown | null;
    runtimeDiagnostics?: unknown | null;
    runtimeInnerState?: unknown | null;
    proactiveMessages?: ProactiveMessageRuntime;
  };
  const proactive = compactProactiveRuntime({
    ...state.proactiveMessages,
    ...(runtimePatch.proactiveMessages ?? {}),
  });
  return {
    personaData: stripPersonaRuntimeFields(personaData),
    runtimeLifeState: "runtimeLifeState" in runtimePatch ? runtimePatch.runtimeLifeState ?? null : state.runtimeLifeState,
    runtimeDiagnostics: "runtimeDiagnostics" in runtimePatch ? runtimePatch.runtimeDiagnostics ?? null : state.runtimeDiagnostics,
    runtimeInnerState: "runtimeInnerState" in runtimePatch ? runtimePatch.runtimeInnerState ?? null : state.runtimeInnerState,
    proactiveRuntime: "proactiveMessages" in runtimePatch || Object.keys(proactive).length > 0
      ? proactive
      : null,
    hasRuntimePatch: hasPatch,
  };
}

export function mergePersonaRuntimeIntoPersonaData(
  personaData: unknown,
  runtime: {
    runtimeLifeState?: unknown | null;
    runtimeDiagnostics?: unknown | null;
    runtimeInnerState?: unknown | null;
    proactiveRuntime?: unknown | null;
  } | null | undefined,
): UnknownRecord {
  const data = clonePersonaData(personaData);
  if (!runtime) return data;
  const container: UnknownRecord = runtimeContainer(data);
  if (runtime.runtimeLifeState !== undefined && runtime.runtimeLifeState !== null) {
    container.runtimeLifeState = runtime.runtimeLifeState;
  }
  if (runtime.runtimeDiagnostics !== undefined && runtime.runtimeDiagnostics !== null) {
    container.runtimeDiagnostics = runtime.runtimeDiagnostics;
  }
  if (runtime.runtimeInnerState !== undefined && runtime.runtimeInnerState !== null) {
    container.runtimeInnerState = runtime.runtimeInnerState;
  }
  if (isRecord(runtime.proactiveRuntime) && Object.keys(runtime.proactiveRuntime).length > 0) {
    container.proactiveMessages = runtime.proactiveRuntime;
  }
  return setRuntimeContainer(data, container);
}
