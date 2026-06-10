import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_FLASH_PROVIDER,
  DEEPSEEK_PRO_PROVIDER,
  deepSeekProviderForPurpose,
  resolveDeepSeekProvider,
} from "./deepseek-routing";

describe("DeepSeek provider routing", () => {
  it("uses Flash for ordinary chat through the dynamic deepseek alias", () => {
    expect(resolveDeepSeekProvider("deepseek", "chat", "openai")).toBe(DEEPSEEK_FLASH_PROVIDER);
    expect(resolveDeepSeekProvider(undefined, "chat", "deepseek")).toBe(DEEPSEEK_FLASH_PROVIDER);
  });

  it("uses Pro for high reasoning purposes through the dynamic deepseek alias", () => {
    expect(resolveDeepSeekProvider("DeepSeek", "source_recall", "openai")).toBe(DEEPSEEK_PRO_PROVIDER);
    expect(resolveDeepSeekProvider("deepseek", "roleplay", "openai")).toBe(DEEPSEEK_PRO_PROVIDER);
    expect(resolveDeepSeekProvider("deepseek", "reflection", "openai")).toBe(DEEPSEEK_PRO_PROVIDER);
    expect(resolveDeepSeekProvider(undefined, "persona_analysis", "deepseek")).toBe(DEEPSEEK_PRO_PROVIDER);
    expect(deepSeekProviderForPurpose("graduation")).toBe(DEEPSEEK_PRO_PROVIDER);
  });

  it("keeps explicit provider choices unchanged", () => {
    expect(resolveDeepSeekProvider("DeepSeek-Pro", "chat", "deepseek")).toBe("DeepSeek-Pro");
    expect(resolveDeepSeekProvider("DeepSeek-Flash", "source_recall", "deepseek")).toBe("DeepSeek-Flash");
    expect(resolveDeepSeekProvider("OpenAI", "source_recall", "deepseek")).toBe("OpenAI");
  });

  it("does not route when the default provider is not the dynamic deepseek alias", () => {
    expect(resolveDeepSeekProvider(undefined, "chat", "openai")).toBeUndefined();
    expect(resolveDeepSeekProvider(undefined, "source_recall", "DeepSeek-Pro")).toBeUndefined();
  });
});
