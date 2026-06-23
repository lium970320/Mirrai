import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./auth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { startProactiveScheduler } from "../social/proactive-scheduler";
import { startDailyMemoryScheduler } from "../social/daily-memory";
import { startScheduledPhotos } from "../social/scheduled-photo";
import { registerQqRoutes } from "../qq/routes";

function assertSecureSessionSecretInProduction() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "dev-secret-change-me" || secret.length < 32) {
    throw new Error(
      "[Auth] 生产环境必须配置一个不少于 32 位的随机 JWT_SECRET，否则会话 token 可被伪造。" +
      "请在 .env 中设置 JWT_SECRET 后重启。",
    );
  }
}

async function startServer() {
  assertSecureSessionSecretInProduction();
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  const uploadsPath = path.resolve(ENV.uploadDir);
  app.use("/uploads", express.static(uploadsPath));

  registerQqRoutes(app);
  registerAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[Server] 端口 ${preferredPort} 已被占用。请释放该端口，或在 .env 设置 PORT 指定其他端口后重启。` +
        "（不再自动顺延端口，避免落到 NapCat OneBot 默认的 3001，并让运维脚本的端口检测保持一致。）",
      );
      process.exit(1);
    }
    throw err;
  });
  server.listen(preferredPort, () => {
    console.log(`Server running on http://localhost:${preferredPort}/`);
  });

  startProactiveScheduler();
  startDailyMemoryScheduler();
  startScheduledPhotos();
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
