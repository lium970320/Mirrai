import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./auth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { startProactiveScheduler } from "../social/proactive-scheduler";
import { startDailyMemoryScheduler } from "../social/daily-memory";
import { registerQqRoutes } from "../qq/routes";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

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
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  startProactiveScheduler();
  startDailyMemoryScheduler();
}

startServer().catch(console.error);
