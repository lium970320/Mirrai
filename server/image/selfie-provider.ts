import { spawn } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { readFile, rm } from "fs/promises";
import { createHash } from "crypto";
import os from "os";
import path from "path";
import { ENV } from "../_core/env";
import { getPersonaScheduleState } from "../_core/life-schedule";

/**
 * 人物自拍生成：把「基准脸 + 当前情境」交给本机的 chatgpt-project-prompt-pusher
 * （`--generate` 无头入口）推到网页版 ChatGPT 出图，再把下载到的图片路径取回。
 *
 * 约束（来自 pusher）：它独占登录用的 Chrome profile，因此本模块强制串行，并在每次
 * 调用前清掉占用该 profile 的残留 Chrome。任何失败都返回 null，由上层退回纯文字。
 * 默认关闭（PERSONA_SELFIE_ENABLED=false）时 resolveConfig 返回 null，不会触碰外部进程。
 */

export type SelfieResult = { imagePath: string };

export type SelfieSceneContext = {
  timeLabel: string;
  dayPart: string;
  lightingHint: string;
  defaultScene: string;
};

// 按一天中的分钟数给出与时间相符的光线（防止深夜生成大白天的照片）。纯函数。
export function lightingForMinute(minute: number): string {
  if (minute < 360 || minute >= 1320) return "深夜，光线昏暗，只有床头灯/夜灯或手机屏幕的微光";
  if (minute < 540) return "清晨，光线柔和偏冷";
  if (minute < 1080) return "白天，光线明亮自然";
  return "傍晚到夜里，室内暖色灯光";
}

// 按作息状态类别给出默认场景（用户不指定情境时用）。纯函数。
export function sceneForScheduleCategory(category: string, stateId: string): string {
  switch (category) {
    case "sleep": return "在卧室床上，睡眼惺忪、慵懒放松，穿睡衣或家居服";
    case "wake": return "刚起床，在家里洗漱或吃早饭，略带睡意，家居装扮";
    case "work": return "在办公室/工位，桌上有资料，穿着得体，工作间隙随手自拍";
    case "commute": return "在通勤路上（街道或车里）";
    case "meal": return "在餐桌前或厨房，正是吃饭时间";
    case "rest": return stateId === "weekend_errands" ? "在外面散步或买菜的路上" : "在家中休息，比较放松";
    case "home":
    default: return "在家中（客厅或书房），放松居家的状态";
  }
}

// 取人物此刻的作息，组装自拍情境上下文（时间/光线/默认场景）。
export function buildScheduleSelfieContext(now = new Date()): SelfieSceneContext {
  const state = getPersonaScheduleState(now);
  return {
    timeLabel: state.timeKey,
    dayPart: state.dayPart,
    lightingHint: lightingForMinute(state.minute),
    defaultScene: sceneForScheduleCategory(state.category, state.stateId),
  };
}

// 把基准脸锚点 + 情境拼成写实生图提示词。纯函数，便于单测。
// 带 context 时锚定此刻时间/光线，避免半夜生成大白天的画面；不指定情境则用作息默认场景。
export function buildSelfiePrompt(situation: string, context?: SelfieSceneContext): string {
  const userScene = situation.trim();
  const scene = userScene || context?.defaultScene || "在家中自然放松的状态，对着镜头温和微笑";
  const timeLine = context
    ? `现在是北京时间 ${context.timeLabel}（${context.dayPart}），画面光线和环境必须符合此刻：${context.lightingHint}。`
    : "";
  return [
    "参考所附的这张脸，生成同一个人的写实照片：",
    timeLine,
    scene,
    "。画面必须与上面说的此刻时间一致，绝不能出现与时间矛盾的场景（例如深夜却是强烈日光或户外大太阳）。",
    "务必保持和参考图是同一个人——同样的五官、发型、体型和气质，只是场景、动作、表情和穿着按描述变化。",
    "竖构图，写实手机拍摄质感，不要卡通或插画风。",
  ].join("");
}

// 环境/场景照提示词：参考"家"的图，生成同一处场景、符合此刻时间的写实照片。
export function buildEnvironmentPrompt(situation: string, context?: SelfieSceneContext): string {
  const what = situation.trim() || "家里此刻的样子";
  const timeLine = context
    ? `现在是北京时间 ${context.timeLabel}（${context.dayPart}），光线和环境必须符合此刻：${context.lightingHint}。`
    : "";
  return [
    "参考所附的这张图（这是你家/你所在的环境），生成同一处场景的写实照片：",
    timeLine,
    what,
    "。务必和参考图是同一个地方——同样的布置、家具和风格，只是按描述变换角度、物件或此刻状态；可以有人入镜，也可以只拍环境。",
    "写实手机随手拍质感，不要卡通或插画风。",
  ].join("");
}

type SelfieConfig = {
  dotnetPath: string;
  project: string;
  pusherConfig: string;
  baseFace: string;
  homeRef?: string; // 环境照参考图（"家"），可选；未配则环境照不可用
  targetUrl: string;
  profileHint: string;
  timeoutMs: number;
};

function resolveConfig(): SelfieConfig | null {
  if (!ENV.personaSelfieEnabled) return null;
  const project = ENV.personaSelfiePusherProject;
  const pusherConfig = ENV.personaSelfiePusherConfig;
  const baseFace = ENV.personaSelfieBaseFacePath;
  const targetUrl = ENV.personaSelfieTargetUrl;
  const missing: string[] = [];
  if (!project) missing.push("PERSONA_SELFIE_PUSHER_PROJECT");
  if (!pusherConfig) missing.push("PERSONA_SELFIE_PUSHER_CONFIG");
  if (!baseFace) missing.push("PERSONA_SELFIE_BASE_FACE_PATH");
  if (!targetUrl) missing.push("PERSONA_SELFIE_TARGET_URL");
  if (missing.length > 0) {
    console.warn(`persona_selfie_config_incomplete missing=${missing.join(",")}`);
    return null;
  }
  if (!existsSync(baseFace)) {
    console.warn(`persona_selfie_base_face_missing path=${baseFace}`);
    return null;
  }
  return {
    dotnetPath: ENV.personaSelfieDotnetPath,
    project,
    pusherConfig,
    baseFace,
    homeRef: ENV.personaSelfieHomeRefPath || undefined,
    targetUrl,
    profileHint: ENV.personaSelfieProfileHint,
    timeoutMs: Math.max(60_000, ENV.personaSelfieTimeoutMs),
  };
}

// pusher 独占登录 Chrome profile —— 必须串行；用一个 Promise 链做互斥，且异常不阻断后续任务。
let selfieChain: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = selfieChain.then(task, task);
  selfieChain = next.then(() => undefined, () => undefined);
  return next;
}

function spawnAndWait(
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<number | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(command, args, {
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(null);
    }, opts.timeoutMs);
    child.on("error", () => finish(null));
    child.on("close", code => finish(code));
  });
}

// 关掉占用登录 profile 的残留 Chrome，避免 pusher 打开时报 "Browser is already in use"。best-effort。
async function clearProfileLock(profileHint: string): Promise<void> {
  if (process.platform !== "win32") return;
  const hint = profileHint.replace(/['"]/g, "");
  if (!hint) return;
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue `
    + `| Where-Object { $_.CommandLine -match '${hint}' } `
    + `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await spawnAndWait(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: 20_000 },
  );
}

type GenerateResultJson = {
  success?: boolean;
  exitCode?: number;
  downloadedImages?: string[];
  downloadDir?: string;
};

// pusher 会把上传的参考图副本一并下载（与基准脸同内容/同大小），必须排除，否则会把原图当自拍发回。
// 生成图通常排在参考图副本之后，取过滤后的最后一张；若过滤后为空（只下到参考图=没真生成）返回 undefined。
export function pickGeneratedImage(
  images: string[],
  isReferenceCopy: (path: string) => boolean,
): string | undefined {
  const candidates = images.filter(path => path && !isReferenceCopy(path));
  return candidates.length ? candidates[candidates.length - 1] : undefined;
}

// 兜底：pusher 结果 JSON 可能在真生成图落盘前就写了、只装进参考图副本（漏了真生成图），
// 导致上面 pickGeneratedImage 过滤完为空。dotnet run 退出 = 本次下载全部完成，此时直接从
// 下载目录补取「本次新生成」的真图：本次运行后产生（mtime≥sinceMs）、非参考图大小、取最新一张。纯函数便于单测。
export function pickGeneratedImageFromDir(
  files: Array<{ path: string; size: number; mtimeMs: number }>,
  baseSize: number,
  sinceMs: number,
): string | undefined {
  const candidates = files
    .filter(file => file.mtimeMs >= sinceMs)
    .filter(file => baseSize <= 0 || file.size !== baseSize)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.length ? candidates[0].path : undefined;
}

// 按"拍哪个区域"选对应的家参考图（卧室/厨房/客厅/书房/阳台/卫生间/玄关）。
// 先看场景文字关键词，否则按当前作息推断；命中且图存在才返回，否则 undefined（上层退回单图 homeRef）。
const HOME_REGION_KEYWORDS: Array<[RegExp, string]> = [
  [/卧室|床上|床边|被窝|睡觉|躺/, "bedroom"],
  [/厨房|做饭|做菜|灶台|下厨|炒菜/, "kitchen"],
  [/书房|看书|读书|工作|办公|书桌|电脑/, "study"],
  [/阳台|窗外|外面的?风?景|晾/, "balcony"],
  [/卫生间|浴室|洗澡|洗漱|淋浴|马桶|镜子前/, "bathroom"],
  [/玄关|门口|出门|到家|进门|换鞋/, "entry"],
  [/客厅|沙发|看电视|茶几/, "livingroom"],
];

export function regionForScheduleCategory(category: string): string {
  switch (category) {
    case "sleep":
    case "wake": return "bedroom";
    case "meal": return "kitchen";
    case "work": return "study";
    case "home":
    case "rest":
    default: return "livingroom";
  }
}

export function resolveHomeRegionRef(situation: string, now = new Date()): string | undefined {
  const dir = ENV.personaSelfieHomeDir;
  if (!dir) return undefined;
  const text = (situation ?? "").replace(/\s+/g, "");
  let region = "";
  for (const [re, r] of HOME_REGION_KEYWORDS) {
    if (re.test(text)) { region = r; break; }
  }
  if (!region) region = regionForScheduleCategory(getPersonaScheduleState(now).category);
  const candidate = path.join(dir, `${region}.png`);
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * 生成一张人物自拍，返回本地图片路径；任何失败（未开启 / 配置不全 / 超时 / 被拒 / 没出图）都返回 null。
 * 调用是串行的：多个请求会排队，一次只跑一张。
 */
export async function generatePersonaSelfie(
  situation: string,
  kind: "selfie" | "environment" = "selfie",
): Promise<SelfieResult | null> {
  const config = resolveConfig();
  if (!config) return null;

  return runExclusive(async () => {
    const context = buildScheduleSelfieContext();
    const attachment = kind === "environment"
      ? (resolveHomeRegionRef(situation) ?? config.homeRef)
      : config.baseFace;
    if (!attachment) {
      console.warn(`persona_selfie_no_reference kind=${kind}（环境照需配 PERSONA_SELFIE_HOME_REF_PATH）`);
      return null;
    }
    const prompt = kind === "environment"
      ? buildEnvironmentPrompt(situation, context)
      : buildSelfiePrompt(situation, context);
    const outJson = path.join(
      os.tmpdir(),
      `mirrai-selfie-${createHash("sha256").update(`${prompt}${Date.now()}`).digest("hex").slice(0, 12)}.json`,
    );
    const startedAt = Date.now();
    try {
      await clearProfileLock(config.profileHint);
      const args = [
        "run", "--project", config.project, "-c", "Release", "--",
        "--generate",
        "--prompt", prompt,
        "--attachment-path", attachment,
        "--target-url", config.targetUrl,
        "--output-json", outJson,
      ];
      const code = await spawnAndWait(config.dotnetPath, args, {
        env: { ...process.env, CHATGPT_PROMPT_PUSHER_CONFIG: config.pusherConfig },
        timeoutMs: config.timeoutMs,
      });
      if (code === null) {
        console.warn(`persona_selfie_timeout_or_spawn_error elapsedMs=${Date.now() - startedAt}`);
        return null;
      }
      if (!existsSync(outJson)) {
        console.warn(`persona_selfie_no_result_json exitCode=${code}`);
        return null;
      }
      const parsed = JSON.parse(await readFile(outJson, "utf8")) as GenerateResultJson;
      const baseSize = existsSync(attachment) ? statSync(attachment).size : -1;
      const isReferenceCopy = (entry: string): boolean => {
        if (!existsSync(entry)) return true; // 不存在的当作不可用，过滤掉
        try {
          return baseSize > 0 && statSync(entry).size === baseSize;
        } catch {
          return true;
        }
      };
      let image = pickGeneratedImage(parsed.downloadedImages ?? [], isReferenceCopy);
      if (!image && typeof parsed.downloadDir === "string" && existsSync(parsed.downloadDir)) {
        try {
          const dir = parsed.downloadDir;
          const entries = readdirSync(dir)
            .filter(name => /\.(png|jpe?g|webp)$/i.test(name))
            .map(name => {
              const full = path.join(dir, name);
              const st = statSync(full);
              return { path: full, size: st.size, mtimeMs: st.mtimeMs };
            });
          image = pickGeneratedImageFromDir(entries, baseSize, startedAt);
          if (image) console.info(`persona_selfie_recovered_from_dir image=${image}`);
        } catch (scanErr) {
          console.warn("persona_selfie_dir_scan_failed", scanErr);
        }
      }
      // 以「是否真拿到生成图」为准，而非 pusher 的 success 标志——后者把只下到参考图副本也算成功。
      if (!image) {
        console.warn(
          `persona_selfie_no_generated_image exitCode=${code} success=${parsed.success ?? false} total=${parsed.downloadedImages?.length ?? 0}`,
        );
        return null;
      }
      console.info(`persona_selfie_success elapsedMs=${Date.now() - startedAt} image=${image}`);
      return { imagePath: image };
    } catch (err) {
      console.warn("persona_selfie_error", err);
      return null;
    } finally {
      await rm(outJson, { force: true }).catch(() => undefined);
    }
  });
}
