import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectSticker } from "./sticker-selector";
import type { PersonaSticker } from "./persona-stickers";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrai-stickers-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeSticker(name: string): void {
  fs.writeFileSync(path.join(tempDir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe("sticker selector", () => {
  it("selects an existing sticker by mood and tags", () => {
    writeSticker("shy.png");
    const stickers: PersonaSticker[] = [
      {
        id: "shy",
        path: "shy.png",
        enabled: true,
        mood: ["害羞"],
        tags: ["soft"],
        intensity: 2,
        type: "png",
      },
    ];

    const result = selectSticker({
      contactId: "qq:private:1",
      stickerIntent: { shouldSend: true, mood: "害羞", intensity: 2, tags: ["soft"] },
      stickers,
      baseDir: tempDir,
      random: () => 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sticker.id).toBe("shy");
      expect(result.sticker.path).toBe(path.join(tempDir, "shy.png"));
    }
  });

  it("returns not found when the matched file is missing", () => {
    const stickers: PersonaSticker[] = [
      {
        id: "missing",
        path: "missing.png",
        enabled: true,
        mood: ["开心"],
        tags: ["positive"],
        intensity: 2,
        type: "png",
      },
    ];

    const result = selectSticker({
      contactId: "qq:private:1",
      stickerIntent: { shouldSend: true, mood: "开心", intensity: 2, tags: ["positive"] },
      stickers,
      baseDir: tempDir,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("sticker_not_found");
    }
  });
});
