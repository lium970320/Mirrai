import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes and verifies a password (scrypt round-trip)", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect((await verifyPassword("correct horse battery", hash)).ok).toBe(true);
    expect((await verifyPassword("wrong password", hash)).ok).toBe(false);
  });

  it("does not flag scrypt hashes for upgrade", async () => {
    const result = await verifyPassword("pw12345", await hashPassword("pw12345"));
    expect(result.ok).toBe(true);
    expect(result.needsUpgrade).toBe(false);
  });

  it("verifies legacy sha256 hashes and flags them for upgrade", async () => {
    const salt = "a1b2c3d4e5f6a7b8";
    const legacy = `${salt}:${createHash("sha256").update("legacy-pass" + salt).digest("hex")}`;
    const ok = await verifyPassword("legacy-pass", legacy);
    expect(ok.ok).toBe(true);
    expect(ok.needsUpgrade).toBe(true);
    expect((await verifyPassword("nope", legacy)).ok).toBe(false);
  });

  it("rejects empty or malformed stored hashes safely", async () => {
    expect((await verifyPassword("x", null)).ok).toBe(false);
    expect((await verifyPassword("x", "")).ok).toBe(false);
    expect((await verifyPassword("x", "garbage")).ok).toBe(false);
    expect((await verifyPassword("x", "scrypt$onlyonepart")).ok).toBe(false);
  });
});
