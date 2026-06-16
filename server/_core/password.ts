import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_PREFIX = "scrypt$";

export type PasswordVerifyResult = {
  ok: boolean;
  /** 旧 sha256 哈希校验通过：调用方应顺手用 hashPassword 重新写入，惰性升级到 scrypt。 */
  needsUpgrade: boolean;
};

function deriveScryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** 用 scrypt 生成密码哈希，格式 `scrypt$<saltHex>$<derivedHex>`。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await deriveScryptKey(password, salt);
  return `${SCRYPT_PREFIX}${salt}$${derived.toString("hex")}`;
}

function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  // timingSafeEqual 要求等长；长度不等直接判否，避免抛错也避免计时差异泄露。
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 校验密码，兼容两种存储格式：
 * - 新格式 `scrypt$salt$hash`（scrypt，慢哈希）
 * - 旧格式 `salt:hash`（单轮 sha256，历史用户）；校验通过时标记 needsUpgrade，便于惰性升级。
 * 全程用 timingSafeEqual 做常量时间比较。
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<PasswordVerifyResult> {
  if (!stored) return { ok: false, needsUpgrade: false };

  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, salt, hashHex] = stored.split("$");
    if (!salt || !hashHex) return { ok: false, needsUpgrade: false };
    const derived = await deriveScryptKey(password, salt);
    return { ok: safeEqualHex(derived.toString("hex"), hashHex), needsUpgrade: false };
  }

  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return { ok: false, needsUpgrade: false };
  const inputHash = createHash("sha256").update(password + salt).digest("hex");
  const ok = safeEqualHex(inputHash, storedHash);
  return { ok, needsUpgrade: ok };
}
