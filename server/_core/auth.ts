import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";
import { hashPassword, verifyPassword } from "./password";

// 简单的内存级登录/注册限流：按客户端 IP 在滑动窗口内限制尝试次数，缓解撞库/暴力破解。
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX_ATTEMPTS = 20;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function authClientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined)
    || req.socket?.remoteAddress
    || "unknown";
  return ip;
}

function consumeAuthAttempt(key: string): boolean {
  const now = Date.now();
  if (authAttempts.size > 5000) {
    for (const [k, v] of authAttempts) if (now > v.resetAt) authAttempts.delete(k);
  }
  const entry = authAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AUTH_RATE_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export type SessionPayload = {
  userId: number;
  name: string;
};

function getSessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  if (!cookieHeader) return new Map();
  return new Map(Object.entries(parseCookieHeader(cookieHeader)));
}

export async function createSessionToken(
  userId: number,
  name: string
): Promise<string> {
  const secret = getSessionSecret();
  const expiresAt = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ userId, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expiresAt)
    .sign(secret);
}

export async function verifySession(
  cookieValue: string | undefined | null
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  try {
    const secret = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secret, {
      algorithms: ["HS256"],
    });
    const { userId, name } = payload as Record<string, unknown>;
    if (typeof userId !== "number" || typeof name !== "string") return null;
    return { userId, name };
  } catch {
    return null;
  }
}

export async function authenticateRequest(req: Request): Promise<User> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySession(sessionCookie);
  if (!session) throw ForbiddenError("Invalid session");

  const user = await db.getUserById(session.userId);
  if (!user) throw ForbiddenError("User not found");
  return user;
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const rateKey = authClientKey(req);
    if (!consumeAuthAttempt(rateKey)) {
      res.status(429).json({ error: "请求过于频繁，请稍后再试" });
      return;
    }
    const { username, password } = req.body;
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    if (username.length < 2 || username.length > 50) {
      res.status(400).json({ error: "username must be 2-50 characters" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "password must be at least 6 characters" });
      return;
    }

    try {
      const existing = await db.getUserByUsername(username);
      if (existing) {
        res.status(409).json({ error: "username already taken" });
        return;
      }

      const passwordHash = await hashPassword(password);

      const userId = await db.createUser({
        username,
        passwordHash,
        name: username,
      });

      const token = await createSessionToken(userId, username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, userId });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const rateKey = authClientKey(req);
    if (!consumeAuthAttempt(rateKey)) {
      res.status(429).json({ error: "登录尝试过于频繁，请稍后再试" });
      return;
    }
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    try {
      const user = await db.getUserByUsername(username);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "invalid credentials" });
        return;
      }

      const verifyResult = await verifyPassword(password, user.passwordHash);
      if (!verifyResult.ok) {
        res.status(401).json({ error: "invalid credentials" });
        return;
      }
      if (verifyResult.needsUpgrade) {
        // 旧 sha256 哈希校验通过，惰性升级到 scrypt；升级失败也不影响本次登录。
        try {
          await db.updateUserPassword(user.id, await hashPassword(password));
        } catch (err) {
          console.warn("[Auth] password rehash failed:", err);
        }
      }

      await db.updateUserLastSignedIn(user.id);
      authAttempts.delete(rateKey);

      const token = await createSessionToken(user.id, user.name || username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, userId: user.id });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
