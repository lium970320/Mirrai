import { timingSafeEqual } from "crypto";
import type { Express, Request } from "express";
import { ENV } from "../_core/env";
import { handleQqOneBotEvent } from "./message-handler";

function safeTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readBearerToken(req: Request): string {
  const authorization = req.headers.authorization;
  if (!authorization) return "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function isAuthorized(req: Request): boolean {
  const secret = ENV.qqOnebotWebhookSecret;
  if (!secret) return true;
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const headerToken = typeof req.headers["x-mirrai-token"] === "string" ? req.headers["x-mirrai-token"] : "";
  return [queryToken, headerToken, readBearerToken(req)].some(token => safeTokenEqual(token, secret));
}

export function registerQqRoutes(app: Express) {
  app.post("/api/qq/onebot/event", async (req, res) => {
    if (!ENV.qqEnabled) {
      res.json({ status: "disabled" });
      return;
    }

    if (!isAuthorized(req)) {
      res.status(401).json({ status: "unauthorized" });
      return;
    }

    try {
      const result = await handleQqOneBotEvent(req.body);
      res.json({ status: "ok", ...result });
    } catch (err) {
      console.error("[QQ] OneBot event handling failed:", err);
      res.json({ status: "ok", handled: false, reason: "handler_error" });
    }
  });
}
