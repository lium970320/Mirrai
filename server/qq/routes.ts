import type { Express, Request } from "express";
import { ENV } from "../_core/env";
import { handleQqOneBotEvent } from "./message-handler";

function readBearerToken(req: Request): string {
  const authorization = req.headers.authorization;
  if (!authorization) return "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function isAuthorized(req: Request): boolean {
  if (!ENV.qqOnebotWebhookSecret) return true;
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const headerToken = typeof req.headers["x-mirrai-token"] === "string" ? req.headers["x-mirrai-token"] : "";
  return [queryToken, headerToken, readBearerToken(req)].some(token => token === ENV.qqOnebotWebhookSecret);
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
