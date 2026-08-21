import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { extname, join, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { formatFromPath, toDocument, toMarkdownBytes, toMarkdown } from "@firecrawl/anydoc";
import { createHash, randomUUID } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { LlmAdapter, contentHasImage } from "@deepseek-ai/dsh-llm";
const NAMESPACE = "omnifile";
const KIND_IMAGE = "image";
const KIND_DOC = "doc";
const KIND_TEXT = "text";
const KIND_MEDIA = "media";
const KIND_OTHER = "other";
const MARKER_PREFIX = "解析后保存路径：";
const MARKER_STATUS_OK = "完整内容见上方文件卡片，可点击展开";
const MARKER_STATUS_UNREADABLE = "无法按文本读取";
const MARKER_STATUS_FAILED = "解析失败";
const MARKER_UNKNOWN = "未知原因";
const MARKER_SOURCE_TAG = "源文件：";
function markerText(path, options = {}) {
  const p = String(path || "");
  const isOk = options.ok === true || options.ok === MARKER_STATUS_OK;
  if (isOk) {
    const sourceTail = typeof options.source === "string" && options.source !== "" && options.source !== p ? "；" + MARKER_SOURCE_TAG + options.source : "";
    return MARKER_PREFIX + p + "（" + MARKER_STATUS_OK + sourceTail + "）";
  }
  const status = options.ok === false ? MARKER_STATUS_FAILED : typeof options.ok === "string" && options.ok !== "" ? options.ok : MARKER_STATUS_UNREADABLE;
  const noteText = typeof options.note === "string" && options.note !== "" ? "：" + options.note : "";
  return MARKER_PREFIX + p + "（" + status + noteText + "）";
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
const VARIANT_PREFIX = "omnifile-";
const VARIANT_SUFFIX = " (Omnifile)";
const DEFAULT_DESCRIBE_PROMPT = "请按要求描述这张图片。";
const DESCRIBE_SYSTEM = [
  "你是图像识别助手。用户消息包含一张图片，请客观、详尽地描述它的全部内容，供一个无法查看图片的 AI 助手使用。要求：",
  "1. 完整转写图片中出现的所有文字（代码、报错、日志、界面文案等按原样转写，保留换行与缩进）。",
  "2. 描述界面布局、图表结构、颜色和其他显著视觉元素。",
  "3. 只陈述图片中可见的信息，不要推测或评价。",
  "使用与图片中文字相同的语言作答；图片没有文字时使用中文。"
].join("\n");
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const BASE64_INFLATE = 4 / 3;
const MAX_SAVE_FALLBACK_BYTES = 50 * 1024 * 1024;
let maxNameChars = 120;
let describeCacheMax = 300;
function nameCharLimit() {
  return maxNameChars;
}
function describeCacheLimit() {
  return describeCacheMax;
}
function syncRunLimits(cfg) {
  maxNameChars = Math.max(8, Number(cfg.maxNameChars) || 120);
  describeCacheMax = Math.max(16, Number(cfg.describeCacheMax) || 300);
}
const Config = z.object({
  providerRef: z.string().default("").description("「设置-模型」中选择的多模态模型引用（<命名空间>/<提供商>/<模型id>）"),
  reasoningEffort: z.string().default("medium").description("启用思考模式时发送的 reasoning_effort 值"),
  thinking: z.boolean().default(false).description("是否启用多模态模型的思考模式（默认禁止）"),
  describePrompt: z.string().default(DEFAULT_DESCRIBE_PROMPT).description("发送给多模态模型识图时的固定提问"),
  enableVariants: z.boolean().default(true).description("为文本-only 主模型注册 omnifile-* 图像变体提供商"),
  timeoutMs: z.number().default(6e4).description("单次多模态调用的超时（毫秒）"),
  maxFileBytes: z.number().default(50 * 1024 * 1024).description("单个上传文件大小上限"),
  maxDocImages: z.number().default(8).description("单个文档最多交给多模态识别的内嵌图片数"),
  docMaxChars: z.number().default(12e4).description("文档转 Markdown 后保留的最大字符数（超出部分截断）"),
  concurrency: z.number().default(1).description("调用多模态模型的并发数（默认 1）"),
  temperature: z.number().default(0.7).description("多模态模型采样温度（0-2，默认 0.7）"),
  topP: z.number().default(1).description("多模态模型 nucleus 采样 top_p（0-1）"),
  maxTokens: z.number().default(8192).description("多模态模型单次输出最大 token 数（默认 8192）"),
  /* 上限类参数（可在设置界面配置） */
  describeCacheMax: z.number().default(300).description("多模态识图结果缓存条数上限（LRU，默认 300）"),
  listMaxFiles: z.number().default(2e3).description("@ 文件选择器最多列出工作区文件数（默认 2000）"),
  listMaxDepth: z.number().default(12).description("@ 文件选择器递归遍历最大深度（默认 12）"),
  maxNameChars: z.number().default(120).description("文件名清洗后的最大长度，字符（默认 120）"),
  maxBatchImages: z.number().default(20).description("一次粘贴/拖拽最多放入原生附件的图片数（客户端，默认 20）"),
  progressPollMs: z.number().default(400).description("解析进度轮询间隔，毫秒（客户端，默认 400）")
});
function docChars(cfg) {
  return Math.max(1, Number(cfg?.docMaxChars) || 12e4);
}
function imageBudget(cfg, override) {
  return cfg?.maxDocImages || 8;
}
const LOG_PREFIX = "[dsh-omnifile]";
function debugLog(...args) {
  if (process.env.DSH_OMNIFILE_DEBUG === "1") console.error(LOG_PREFIX, ...args);
}
const IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".avif"]);
const TEXT_EXTENSIONS = /* @__PURE__ */ new Set([".json", ".txt", ".md", ".html", ".shtml"]);
const MEDIA_EXTENSIONS = /* @__PURE__ */ new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ts"]);
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif"
};
const DOC_EXTENSIONS_FALLBACK = /* @__PURE__ */ new Set([".doc", ".docx", ".docm", ".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm", ".xls", ".xlsx", ".xlsm", ".xlsb", ".odt", ".ods", ".odp", ".rtf", ".epub", ".csv", ".pdf"]);
function fileKind(name2) {
  const ext = extname(name2).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return KIND_IMAGE;
  if (typeof formatFromPath === "function") {
    try {
      if (formatFromPath(name2) !== null) return KIND_DOC;
    } catch {
    }
  }
  if (DOC_EXTENSIONS_FALLBACK.has(ext)) return KIND_DOC;
  if (TEXT_EXTENSIONS.has(ext)) return KIND_TEXT;
  if (MEDIA_EXTENSIONS.has(ext)) return KIND_MEDIA;
  return KIND_OTHER;
}
function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolveBody(Buffer.concat(chunks));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readJsonBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const buf = await readBody(req, maxBytes);
  try {
    return buf.length === 0 ? {} : JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}
async function resolveApiKey(ctx, credential) {
  try {
    const ref = credentialRef(String(credential || "").trim());
    const resolved = await ctx.credentials.resolve(ref);
    const key = resolved?.key;
    return typeof key === "string" ? key : "";
  } catch {
    return "";
  }
}
const VISION_HINT_RE = /(^|[-_.\s])(vision|vl|visual|omni|image|img|vlm|multimodal)([-_.\s]|$)/i;
function builtinProviderDefaults(provider, settingsNs) {
  if (provider === "deepseek-official" || settingsNs === "llm-deepseek") {
    return {
      baseUrl: "https://api.deepseek.com",
      credentialEnv: "DEEPSEEK_API_KEY",
      baseUrlEnv: "DEEPSEEK_BASE_URL"
    };
  }
  return null;
}
function inferModelImage(modalities, dir, modelId) {
  if (Array.isArray(modalities) && modalities.includes("image")) return true;
  const profileModels = Array.isArray(dir?.profile?.models) ? dir.profile.models : [];
  const declared = profileModels.find((m) => m !== null && typeof m === "object" && String(m.id ?? "") === modelId);
  if (declared === void 0) return false;
  const modelInput = Array.isArray(declared.input) ? declared.input.map(String) : [];
  if (modelInput.includes("image") || Array.isArray(dir?.defaultInput) && dir.defaultInput.includes("image")) return true;
  const haystack = String(declared.name ?? "") + " " + String(declared.id ?? "");
  return VISION_HINT_RE.test(haystack);
}
async function resolveConfiguredProvider(ctx, providerRef) {
  if (typeof providerRef !== "string" || providerRef === "") return null;
  const parts = providerRef.split("/");
  if (parts.length < 3) return null;
  const ns = parts[0];
  const route = parts[1];
  const modelId = parts.slice(2).join("/");
  const llm = ctx.get("llm");
  if (llm === void 0 || typeof llm.listConfigurableProviders !== "function") return null;
  let directory = [];
  try {
    directory = llm.listConfigurableProviders();
  } catch {
    return null;
  }
  const entry = directory.find((e) => e && e.settingsNs === ns && (e.settingsPath?.[1] === route || e.provider === route));
  if (entry === void 0) return null;
  const settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath : [];
  let raw;
  try {
    raw = ctx.settings?.get ? ctx.settings.get(ns) : void 0;
  } catch {
    raw = void 0;
  }
  let profile = raw;
  try {
    for (const seg of settingsPath) profile = profile === void 0 || profile === null ? void 0 : profile[seg];
  } catch {
    profile = void 0;
  }
  if (profile !== void 0 && profile !== null && typeof profile === "object") {
    const baseUrl = profile.baseURL ?? profile.baseUrl;
    if (typeof baseUrl === "string" && baseUrl !== "") {
      return {
        baseUrl,
        credential: typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : "",
        model: modelId
      };
    }
  }
  if (settingsPath.length === 0) {
    const fallback = builtinProviderDefaults(route, ns);
    if (fallback !== null) {
      const envBase = process.env[fallback.baseUrlEnv];
      const baseUrl = typeof envBase === "string" && envBase !== "" ? envBase : fallback.baseUrl;
      return { baseUrl, credential: fallback.credentialEnv, model: modelId };
    }
  }
  return null;
}
async function enumerateModels(ctx) {
  const llm = ctx.get("llm");
  const providers = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (item) => {
    const dedupe = item.settingsNs + "/" + item.provider + "/" + item.modelId;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    providers.push(item);
  };
  if (llm === void 0) return providers;
  let directory = [];
  try {
    directory = typeof llm.listConfigurableProviders === "function" ? llm.listConfigurableProviders() : [];
  } catch {
  }
  const dirByRoute = /* @__PURE__ */ new Map();
  for (const entry of directory) {
    if (entry === null || typeof entry !== "object") continue;
    const settingsNs = String(entry.settingsNs ?? "");
    const provider = String(entry.provider ?? "");
    const settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath.map(String) : [];
    if (settingsNs === "" || provider === "") continue;
    const route = settingsPath[1] ?? provider;
    let raw;
    try {
      raw = ctx.settings?.get ? ctx.settings.get(settingsNs) : void 0;
    } catch {
      raw = void 0;
    }
    let profile = raw;
    try {
      for (const seg of settingsPath) profile = profile === void 0 || profile === null ? void 0 : profile[seg];
    } catch {
      profile = void 0;
    }
    const baseURL = (typeof profile?.baseURL === "string" ? profile.baseURL : void 0) ?? (typeof profile?.baseUrl === "string" ? profile.baseUrl : "");
    const dir = {
      provider,
      displayName: String(entry.displayName ?? provider),
      settingsNs,
      settingsPath,
      route,
      baseURL: baseURL || "",
      apiKeyEnv: typeof profile?.apiKeyEnv === "string" ? profile.apiKeyEnv : "",
      defaultInput: Array.isArray(profile?.defaultInput) ? profile.defaultInput.map(String) : []
    };
    if (profile !== void 0 && profile !== null && typeof profile === "object" && Array.isArray(profile.models)) {
      dir.profile = profile;
    }
    const slot = settingsNs + "/" + route;
    if (!dirByRoute.has(slot) || dir.baseURL !== "" || dirByRoute.get(slot).baseURL === "") {
      dirByRoute.set(slot, dir);
    } else {
      const prev = dirByRoute.get(slot);
      if (dir.baseURL !== "") prev.baseURL = dir.baseURL;
      if (dir.apiKeyEnv !== "") prev.apiKeyEnv = dir.apiKeyEnv;
      if (dir.defaultInput.length > 0) prev.defaultInput = dir.defaultInput;
    }
  }
  for (const providerInfo of (() => {
    try {
      return typeof llm.listProviders === "function" ? llm.listProviders() : [];
    } catch {
      return [];
    }
  })()) {
    const providerId = String(providerInfo?.id ?? "");
    if (providerId === "" || providerId.startsWith("omnifile-")) continue;
    let models = [];
    try {
      models = typeof llm.listModels === "function" ? await llm.listModels(providerId) : [];
    } catch {
    }
    for (const model of Array.isArray(models) ? models : []) {
      if (model === null || typeof model !== "object") continue;
      const modelId = String(model.id ?? "");
      if (modelId === "") continue;
      const modalities = Array.isArray(model.inputModalities) ? model.inputModalities.map(String) : [];
      let dir;
      for (const d of dirByRoute.values()) {
        if (d.provider === providerId || d.route === providerId) {
          dir = d;
          break;
        }
      }
      const image = inferModelImage(modalities, dir, modelId);
      const settingsNs = dir?.settingsNs ?? "";
      const route = dir?.route ?? providerId;
      push({
        ref: settingsNs + "/" + route + "/" + modelId,
        provider: route,
        providerDisplay: dir?.displayName ?? providerId,
        settingsNs,
        modelId,
        modelName: typeof model.name === "string" && model.name !== "" ? model.name : modelId,
        baseURL: dir?.baseURL ?? "",
        apiKeyEnv: dir?.apiKeyEnv ?? "",
        image,
        modalities: image ? ["text", "image"] : modalities,
        source: "adapter"
      });
    }
  }
  for (const dir of dirByRoute.values()) {
    if (dir.profile === void 0 || dir.route.startsWith("omnifile-")) continue;
    const defaultInput = dir.defaultInput;
    const models = Array.isArray(dir.profile.models) ? dir.profile.models : [];
    for (const model of models) {
      if (model === null || typeof model !== "object") continue;
      const modelId = String(model.id ?? "");
      if (modelId === "") continue;
      const dupKey = dir.settingsNs + "/" + dir.route + "/" + modelId;
      if (seen.has(dupKey)) continue;
      const modelInput = Array.isArray(model.input) ? model.input.map(String) : defaultInput;
      const image = defaultInput.includes("image") || modelInput.includes("image") || inferModelImage([], dir, modelId);
      push({
        ref: dupKey,
        provider: dir.route,
        providerDisplay: dir.displayName,
        settingsNs: dir.settingsNs,
        modelId,
        modelName: typeof model.name === "string" && model.name !== "" ? model.name : modelId,
        baseURL: dir.baseURL,
        apiKeyEnv: dir.apiKeyEnv,
        image,
        modalities: image ? ["text", "image"] : ["text"],
        source: "profile"
      });
    }
  }
  providers.sort((a, b) => String(a.providerDisplay ?? "").localeCompare(String(b.providerDisplay ?? "")) || String(a.modelId ?? "").localeCompare(String(b.modelId ?? "")));
  return providers;
}
const imageHashCache = /* @__PURE__ */ new Map();
const describeCache = /* @__PURE__ */ new Map();
function effectivePrompt(cfg, prompt) {
  return typeof prompt === "string" && prompt !== "" ? prompt : cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT;
}
async function imageHash(imagePath) {
  const stat = await fs.stat(imagePath).catch(() => void 0);
  if (stat === void 0) return null;
  const cached = imageHashCache.get(imagePath);
  if (cached !== void 0 && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.hash;
  const data = await fs.readFile(imagePath);
  const hash = createHash("sha256").update(data).digest("hex");
  imageHashCache.set(imagePath, { size: stat.size, mtimeMs: stat.mtimeMs, hash });
  const cacheLimit = describeCacheLimit();
  if (imageHashCache.size > cacheLimit * 2) {
    for (const key of imageHashCache.keys()) {
      imageHashCache.delete(key);
      if (imageHashCache.size <= cacheLimit) break;
    }
  }
  return hash;
}
function describeCacheGet(key) {
  const entry = describeCache.get(key);
  if (entry === void 0) return void 0;
  describeCache.delete(key);
  describeCache.set(key, entry);
  return entry.value;
}
function describeCacheSet(key, value) {
  describeCache.delete(key);
  describeCache.set(key, { value });
  if (describeCache.size > describeCacheLimit()) {
    const oldest = describeCache.keys().next().value;
    if (oldest !== void 0) describeCache.delete(oldest);
  }
}
function extnameOfMedia(mediaType) {
  switch (String(mediaType).toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/avif":
      return ".avif";
    default:
      return ".img";
  }
}
async function resolveProvider(ctx, cfg) {
  const ref = await resolveConfiguredProvider(ctx, cfg.providerRef);
  if (ref !== null) {
    ref.reasoningEffort = ref.reasoningEffort || cfg.reasoningEffort || "medium";
    return ref;
  }
  if (cfg.providerRef !== void 0 && cfg.providerRef !== "") {
    throw new Error('多模态模型配置无效：providerRef="' + cfg.providerRef + '" 在「设置-模型」中不存在，请重新选择');
  }
  throw new Error("未配置多模态模型：请在设置 → DshOmniFile → 从「设置-模型」中选择一个多模态模型");
}
async function describeImage(ctx, cfg, imagePath, prompt) {
  const provider = await resolveProvider(ctx, cfg);
  const apiKey = await resolveApiKey(ctx, provider.credential);
  const baseUrl = String(provider.baseUrl || "").replace(/\/+$/, "");
  const data = await fs.readFile(imagePath);
  const mime = mimeFor(imagePath);
  const body = {
    model: provider.model,
    messages: [
      { role: "system", content: DESCRIBE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:" + mime + ";base64," + data.toString("base64") } },
          { type: "text", text: prompt || cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT }
        ]
      }
    ],
    stream: false,
    max_tokens: cfg.maxTokens >= 1 ? cfg.maxTokens : 8192
  };
  if (typeof cfg.temperature === "number" && Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature;
  if (typeof cfg.topP === "number" && Number.isFinite(cfg.topP)) body.top_p = cfg.topP;
  const thinking = cfg.thinking === true;
  body.reasoning_effort = thinking ? provider.reasoningEffort || "medium" : "none";
  body.chat_template_kwargs = { enable_thinking: thinking };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 6e4);
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...apiKey !== "" ? { authorization: "Bearer " + apiKey } : {}
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error("多模态模型请求失败 HTTP " + response.status + ": " + detail);
    }
    const json = await response.json();
    const contentValue = json?.choices?.[0]?.message?.content;
    const text = Array.isArray(contentValue) ? contentValue.map((part) => part?.text ?? "").join("") : contentValue;
    const trimmed = String(text ?? "").trim();
    if (trimmed === "") throw new Error("多模态模型返回空内容");
    return trimmed;
  } finally {
    clearTimeout(timer);
  }
}
async function describeImageCached(ctx, cfg, imagePath, prompt) {
  const finalPrompt = effectivePrompt(cfg, prompt);
  const provider = await resolveProvider(ctx, cfg);
  const baseUrl = String(provider.baseUrl || "").replace(/\/+$/, "");
  const model = provider.model;
  const hash = await imageHash(imagePath);
  const key = hash === null ? imagePath : hash + "|" + finalPrompt + "|" + baseUrl + "|" + model;
  const cached = describeCacheGet(key);
  if (cached !== void 0) return cached;
  const text = await describeImage(ctx, cfg, imagePath, finalPrompt);
  describeCacheSet(key, text);
  return text;
}
const ERR_NO_CWD = "当前会话没有工作目录";
function uploadsDir(cwd) {
  return join(resolve(cwd), "uploads");
}
function uploadsImagesDir(cwd) {
  return join(resolve(cwd), "uploads", "images");
}
async function sessionCwd(ctx, sessionId) {
  const session = typeof sessionId === "string" && sessionId !== "" ? ctx.sessions.get(sessionId) : void 0;
  const cwd = session?.header?.cwd;
  if (typeof cwd !== "string" || cwd === "") throw new Error(ERR_NO_CWD);
  return cwd;
}
function agentCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd ?? exec?.agent?.session?.cwd ?? exec?.session?.header?.cwd ?? exec?.cwd;
  if (typeof cwd !== "string" || cwd === "") throw new Error(ERR_NO_CWD);
  return cwd;
}
function assertWorkspacePath(cwd, rawPath) {
  if (typeof rawPath !== "string" || rawPath === "") throw new Error("缺少文件路径");
  const target = resolve(rawPath);
  const root = resolve(cwd) + sep;
  if (target !== resolve(cwd) && !target.startsWith(root)) throw new Error("路径不在会话工作区内");
  return target;
}
function sanitizeName(name2) {
  const base = String(name2 || "").split(/[\\/]/).pop() || "";
  const cleaned = base.replace(/[^\w\u4e00-\u9fa5.\- ]/gu, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "file";
  return cleaned.slice(0, nameCharLimit());
}
function parsedMarkdownPath(cwd, sourcePath, sourceName) {
  const name2 = sanitizeName(sourceName || basename(sourcePath)) || "file";
  return join(resolve(cwd), "uploads", name2 + ".md");
}
async function writeParsedMarkdown(cwd, sourcePath, markdown, sourceName) {
  try {
    const parsedPath = parsedMarkdownPath(cwd, sourcePath, sourceName);
    await fs.mkdir(uploadsDir(cwd), { recursive: true });
    await fs.writeFile(parsedPath, String(markdown ?? ""), "utf8");
    return parsedPath;
  } catch (error) {
    debugLog("写解析结果失败：" + messageOf(error));
    return void 0;
  }
}
function createLimiter(limit) {
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((resolveAcquire) => {
    if (active < max) {
      active += 1;
      resolveAcquire();
      return;
    }
    waiting.push(resolveAcquire);
  });
  const release = () => {
    const next = waiting.shift();
    if (next !== void 0) {
      next();
      return;
    }
    active -= 1;
  };
  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
function countReplacement(text) {
  return (text.match(/\uFFFD/g) || []).length;
}
function decodeWith(label, bytes) {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return null;
  }
}
function utf32Decode(bytes, be) {
  let out = "";
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const cp = be ? (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0 : (bytes[i + 3] << 24 | bytes[i + 2] << 16 | bytes[i + 1] << 8 | bytes[i]) >>> 0;
    if (cp > 1114111 || cp >= 55296 && cp <= 57343) {
      out += "�";
    } else if (cp <= 65535) {
      out += String.fromCharCode(cp);
    } else {
      const v = cp - 65536;
      out += String.fromCharCode(55296 + (v >> 10), 56320 + (v & 1023));
    }
  }
  return out;
}
function tryUtf16NoBom(bytes) {
  const len = bytes.length;
  if (len < 4 || len % 2 !== 0) return null;
  const sample = Math.min(len, 16384);
  let asciiPairs = 0;
  let evenNull = 0;
  let oddNull = 0;
  const isAsciiChar = (b) => b >= 32 && b <= 126 || b === 9 || b === 10 || b === 13;
  for (let i = 0; i + 1 < sample; i += 2) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const aAscii = isAsciiChar(a);
    const bAscii = isAsciiChar(b);
    if (!aAscii && !bAscii) continue;
    asciiPairs += 1;
    if (b === 0 && aAscii) evenNull += 1;
    if (a === 0 && bAscii) oddNull += 1;
  }
  if (asciiPairs < 8) return null;
  if (evenNull / asciiPairs >= 0.8) {
    const le = decodeWith("utf-16le", bytes);
    if (le !== null) return le;
  }
  if (oddNull / asciiPairs >= 0.8) {
    const be = decodeWith("utf-16be", bytes);
    if (be !== null) return be;
  }
  return null;
}
function decodeText(bytes) {
  if (bytes.length === 0) return "";
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    return Buffer.from(bytes.subarray(3)).toString("utf8");
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 254 && bytes[2] === 0 && bytes[3] === 0) {
    return utf32Decode(bytes.subarray(4), false);
  }
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 254 && bytes[3] === 255) {
    return utf32Decode(bytes.subarray(4), true);
  }
  if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) {
    const s = decodeWith("utf-16le", bytes.subarray(2));
    if (s !== null) return s;
  }
  if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) {
    const s = decodeWith("utf-16be", bytes.subarray(2));
    if (s !== null) return s;
  }
  const noBom16 = tryUtf16NoBom(bytes);
  if (noBom16 !== null) return noBom16;
  const utf8 = Buffer.from(bytes).toString("utf8");
  const badCount = countReplacement(utf8);
  if (badCount === 0) return utf8;
  try {
    const gbk = new TextDecoder("gb18030").decode(bytes);
    if (countReplacement(gbk) < badCount) return gbk;
  } catch {
  }
  return utf8;
}
function htmlToText(raw) {
  return String(raw || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function truncateLong(raw, maxChars) {
  const text = String(raw ?? "");
  const max = Math.max(1, Number(maxChars) || 12e4);
  if (text.length <= max) return { body: text, truncated: false };
  return {
    body: text.slice(0, max) + "\n\n...（内容过长，已截断，原文共 " + text.length + " 字符）",
    truncated: true
  };
}
function isBinaryish(bytes, decoded) {
  if (bytes.length === 0) return false;
  if (typeof decoded === "string" && decoded !== "") {
    const sample = decoded.slice(0, 8192);
    let control = 0;
    for (const ch of sample) {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0) {
        control += 1;
      } else if (code < 9) {
        control += 1;
      } else if (code > 13 && code < 32) {
        control += 1;
      } else if (code >= 127 && code < 160) {
        control += 1;
      }
    }
    if (sample.length > 0 && control / sample.length > 0.3) return true;
    const bad = (decoded.match(/\uFFFD/g) || []).length;
    if (decoded.length > 0 && bad / decoded.length > 0.1) return true;
    return false;
  }
  const sampleBytes = bytes.subarray(0, Math.min(bytes.length, 8192));
  let nuls = 0;
  for (const byte of sampleBytes) if (byte === 0) nuls += 1;
  return sampleBytes.length > 0 && nuls / sampleBytes.length > 0.3;
}
async function processText(ctx, cfg, cwd, filePath, fileName) {
  const bytes = await fs.readFile(filePath);
  const ext = extname(fileName || filePath).toLowerCase();
  let raw = decodeText(bytes);
  if (isBinaryish(bytes, raw)) {
    throw new Error("该文件不是文本文件（检测到二进制内容）");
  }
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(raw);
      raw = JSON.stringify(parsed, null, 2);
    } catch {
    }
  } else if (ext === ".html" || ext === ".shtml") {
    raw = htmlToText(raw);
    if (raw === "") raw = decodeText(bytes);
  }
  const { body, truncated } = truncateLong(raw, docChars(cfg));
  return { markdown: body, images: [], truncated };
}
async function renderPdfPagesWithPymupdf(filePath) {
  const script = [
    "import sys",
    "try:",
    "    import pymupdf as fitz",
    "except Exception:",
    "    try:",
    "        import fitz",
    "    except Exception:",
    '        print("__PYMUPDF_MISSING__", file=sys.stderr)',
    "        sys.exit(3)",
    "doc = fitz.open(sys.argv[1])",
    "for i, page in enumerate(doc):",
    "    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))",
    '    print("__PAGE__%d__" % i, file=sys.stderr)',
    // 页面标记只走 stderr，避免污染二进制 stdout
    '    sys.stdout.buffer.write(b"PDFIMG:" + pix.tobytes("png"))',
    "    sys.stdout.buffer.flush()",
    "sys.stdout.buffer.flush()"
  ].join("\n");
  let output = "";
  let meta = "";
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn("python", ["-c", script, filePath], { stdio: ["ignore", "pipe", "pipe"] });
    const outBuf = [];
    child.stdout.on("data", (chunk) => {
      outBuf.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      meta += chunk.toString("utf8");
    });
    child.on("error", rejectRun);
    child.on("close", () => {
      output = Buffer.concat(outBuf);
      resolveRun();
    });
  });
  if (meta.includes("__PYMUPDF_MISSING__")) throw new Error("pymupdf 未安装");
  const pages = [];
  const body = Buffer.from(output);
  const marker = "PDFIMG:";
  const markerBuf = Buffer.from(marker, "latin1");
  let idx = 0;
  while (idx < body.length) {
    const pos = body.indexOf(markerBuf, idx);
    if (pos < 0) break;
    const start = pos + markerBuf.length;
    const next = body.indexOf(markerBuf, start);
    const end = next < 0 ? body.length : next;
    const png = body.subarray(start, end);
    if (png.length > 0) pages.push({ data: Buffer.from(png), mediaType: "image/png", page: pages.length + 1 });
    idx = end;
  }
  return pages;
}
async function describePdfFallback(cfg, filePath) {
  const errors = [];
  try {
    const pages = await renderPdfPagesWithPymupdf(filePath);
    if (pages.length > 0) return { images: pages, errors: [], source: "pymupdf" };
    errors.push("pymupdf 未渲染出页面");
  } catch (error) {
    errors.push("pymupdf 渲染失败：" + messageOf(error));
  }
  return { images: [], errors };
}
async function processDocument(ctx, cfg, cwd, filePath, fileName, limitImages, onProgress) {
  const imagesDir = uploadsImagesDir(cwd);
  const bytes = await fs.readFile(filePath);
  const fmt = typeof formatFromPath === "function" ? formatFromPath(filePath) : void 0;
  const isPdf = fmt === "pdf";
  onProgress?.({ stage: "doc", detail: "正在解析文档...", done: 0, total: 1 });
  let assets = [];
  if (!isPdf) {
    try {
      const document = await toDocument(bytes, fmt ?? void 0);
      assets = Array.isArray(document?.assets) ? document.assets : [];
    } catch (error) {
      debugLog("toDocument failed for", filePath, messageOf(error));
    }
  }
  let markdownRaw = "";
  let mdError = void 0;
  try {
    markdownRaw = await toMarkdownBytes(bytes, fmt ?? void 0);
  } catch (error) {
    mdError = error;
  }
  if (typeof markdownRaw !== "string" || markdownRaw === "") {
    try {
      markdownRaw = await toMarkdown(filePath);
    } catch (error) {
      mdError = mdError ?? error;
    }
  }
  markdownRaw = String(markdownRaw || "");
  const savedImages = [];
  const mdLooksUnsupported = markdownRaw === "" || mdError !== void 0 || /unsupported|OCR|no extractable text|scanned/i.test(markdownRaw);
  if (isPdf && mdLooksUnsupported) {
    try {
      const fallback = await describePdfFallback(cfg, filePath);
      if (fallback.images.length > 0) {
        const budget2 = imageBudget(cfg, limitImages);
        const chosen2 = fallback.images.slice(0, budget2);
        const limitPdf = createLimiter(cfg.concurrency || 1);
        const pdfResults = new Array(chosen2.length);
        await Promise.all(chosen2.map(async (img, index) => {
          try {
            const ext = img.mediaType === "image/jpeg" ? ".jpg" : ".png";
            const stamp = randomUUID().slice(0, 8);
            const base = sanitizeName(fileName).replace(/\.[^.]+$/, "");
            const assetPath = join(imagesDir, base + "-pdf-" + stamp + "-" + (index + 1) + ext);
            await fs.mkdir(imagesDir, { recursive: true });
            await fs.writeFile(assetPath, img.data);
            onProgress?.({ stage: "image", detail: "识别扫描页 " + (index + 1) + "/" + chosen2.length, done: index + 1, total: chosen2.length });
            const description = await limitPdf(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT));
            pdfResults[index] = {
              path: assetPath,
              name: basename(assetPath),
              mediaType: img.mediaType,
              description,
              pdfPage: img.page
            };
          } catch (error) {
            pdfResults[index] = {
              path: void 0,
              name: "pdf-page-" + (index + 1),
              mediaType: img.mediaType,
              error: messageOf(error)
            };
          }
        }));
        for (const entry of pdfResults) savedImages.push(entry);
      }
    } catch (error) {
      debugLog("PDF 图片兜底失败：" + messageOf(error));
    }
  }
  const limit = createLimiter(cfg.concurrency || 1);
  const budget = imageBudget(cfg);
  const candidates = assets.filter((asset) => {
    const mt = String(asset.mediaType || "").toLowerCase();
    return mt.startsWith("image/") && Buffer.isBuffer(asset.data) && asset.data.length > 0;
  });
  const chosen = candidates.slice(0, budget);
  const imageResults = new Array(chosen.length);
  await Promise.all(chosen.map(async (asset, index) => {
    try {
      const ext = extnameOfMedia(asset.mediaType);
      const stamp = randomUUID().slice(0, 8);
      const base = sanitizeName(fileName).replace(/\.[^.]+$/, "");
      const assetPath = join(imagesDir, base + "-" + stamp + "-" + (index + 1) + ext);
      await fs.mkdir(imagesDir, { recursive: true });
      await fs.writeFile(assetPath, asset.data);
      onProgress?.({ stage: "image", detail: "识别内嵌图片 " + (index + 1) + "/" + chosen.length, done: index + 1, total: chosen.length });
      const description = await limit(() => describeImageCached(ctx, cfg, assetPath, cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT));
      imageResults[index] = { path: assetPath, name: basename(assetPath), mediaType: asset.mediaType, description };
    } catch (error) {
      imageResults[index] = {
        path: void 0,
        name: "image-" + (index + 1),
        mediaType: asset.mediaType,
        error: messageOf(error)
      };
    }
  }));
  for (const entry of imageResults) savedImages.push(entry);
  const maxChars = docChars(cfg);
  let body = "";
  if (markdownRaw !== "") {
    body = truncateLong(markdownRaw, maxChars).body;
  } else if (savedImages.length > 0) {
    body = "（该文档文本内容无法提取，已提取其中 " + savedImages.length + " 张图片并识别如下；文件绝对路径：" + filePath + "）";
  } else {
    body = "（该文档无法解析出文本内容，文件已保存，绝对路径：" + filePath + "）";
  }
  const textError = mdError !== void 0 ? messageOf(mdError).slice(0, 300) : void 0;
  if (textError !== void 0) {
    body += "\n\n【解析提示】文本转换未成功：" + textError + "（内容可能仍包含图片，见下方识别结果）";
  }
  if (savedImages.length > 0) {
    const imageSection = savedImages.map((img, i) => {
      if (img.error !== void 0) return "- 图片 " + (i + 1) + "：识别失败（" + img.error + "）";
      const pageTag = img.pdfPage !== void 0 ? "（PDF 第 " + img.pdfPage + " 页）" : "";
      return "- 图片 " + (i + 1) + pageTag + "（" + img.name + "）：" + img.description;
    }).join("\n");
    body += "\n\n【文档内嵌图片识别结果】\n" + imageSection;
  }
  return { markdown: body, images: savedImages, truncated: markdownRaw.length > maxChars, textError };
}
const progressStore = /* @__PURE__ */ new Map();
function setProgress(token, patch) {
  if (typeof token !== "string" || token === "") return;
  const prev = progressStore.get(token);
  progressStore.set(token, { ...prev ?? {}, ...patch, updatedAt: Date.now() });
}
function clearProgress(token) {
  if (typeof token !== "string" || token === "") return;
  progressStore.delete(token);
}
const WALK_SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", ".next", ".nuxt", ".vite", ".turbo", ".cache", "__pycache__", "coverage", ".idea", ".vscode", ".venv", "venv", "uploads"]);
async function walkWorkspaceFiles(cwd, options = {}) {
  const maxFiles = options.maxFiles || 2e3;
  const maxDepth = options.maxDepth || 12;
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = async (dir, rel, depth) => {
    if (files.length >= maxFiles) return;
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const name2 = entry.name;
      const abs = join(dir, name2);
      const relPath = rel === "" ? name2 : rel + "/" + name2;
      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(name2)) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        await walk(abs, relPath, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        let size = 0;
        try {
          const stat = await fs.stat(abs);
          if (!stat.isFile()) continue;
          size = stat.size;
        } catch {
          continue;
        }
        files.push({ name: name2, path: abs, rel: relPath, kind: fileKind(name2), size });
      }
    }
  };
  await walk(resolve(cwd), "", 0);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}
function openLocally(path) {
  return new Promise((resolveOpen) => {
    let child;
    try {
      if (process.platform === "win32") {
        child = spawn("cmd", ["/c", "start", "", path], { detached: true, stdio: "ignore" });
      } else if (process.platform === "darwin") {
        child = spawn("open", [path], { detached: true, stdio: "ignore" });
      } else {
        child = spawn("xdg-open", [path], { detached: true, stdio: "ignore" });
      }
    } catch (error) {
      resolveOpen({ ok: false, error: messageOf(error) });
      return;
    }
    child?.unref?.();
    resolveOpen({ ok: true });
  });
}
function registerRoutes(ctx, getConfig) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) return;
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/common.js",
    handler: async (req, res) => {
      try {
        const commonPath = fileURLToPath(new URL(
          /* @vite-ignore */
          "./common.js",
          import.meta.url
        ));
        const data = await fs.readFile(commonPath);
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "content-length": data.length,
          "cache-control": "no-store"
        });
        res.end(data);
      } catch (error) {
        writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.common-js");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/save",
    handler: async (req, res) => {
      try {
        const cfg = getConfig();
        const maxFileBytes = Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES);
        const maxBase64Chars = Math.ceil(maxFileBytes * BASE64_INFLATE) + 1024;
        const maxBodyBytes = Math.ceil(maxBase64Chars) + 1024 * 1024;
        const body = await readJsonBody(req, maxBodyBytes);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const name2 = typeof body.name === "string" ? body.name : "";
        const base64 = typeof body.base64 === "string" ? body.base64 : "";
        if (sessionId === "" || name2 === "" || base64 === "") {
          return writeJson(res, 400, { ok: false, error: "参数不完整（sessionId/name/base64）" });
        }
        if (base64.length > maxBase64Chars) {
          return writeJson(res, 400, { ok: false, error: "文件过大（超过上传上限）" });
        }
        let bytes;
        try {
          bytes = Buffer.from(base64, "base64");
        } catch {
          return writeJson(res, 400, { ok: false, error: "文件内容无效" });
        }
        if (bytes.length > maxFileBytes) {
          return writeJson(res, 400, {
            ok: false,
            error: "文件超过大小上限 " + Math.round(maxFileBytes / 1024 / 1024) + "MB"
          });
        }
        const cwd = await sessionCwd(ctx, sessionId);
        const fileName = Date.now() + "-" + sanitizeName(name2);
        const dir = uploadsDir(cwd);
        await fs.mkdir(dir, { recursive: true });
        const path = join(dir, fileName);
        await fs.writeFile(path, bytes);
        return writeJson(res, 200, {
          ok: true,
          path,
          name: fileName,
          mime: mimeFor(name2),
          size: bytes.length,
          kind: fileKind(name2)
        });
      } catch (error) {
        debugLog("save failed:", error);
        return writeJson(res, 500, { ok: false, error: "保存失败：" + messageOf(error) });
      }
    }
  }), "dsh-omnifile.save");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/process",
    handler: async (req, res) => {
      let token = "";
      try {
        const body = await readJsonBody(req);
        token = typeof body.token === "string" ? body.token : "";
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const cwd = await sessionCwd(ctx, sessionId);
        const target = assertWorkspacePath(cwd, body.path);
        const cfg = getConfig();
        const kind = typeof body.kind === "string" && body.kind !== "" ? body.kind : fileKind(target);
        const srcName = typeof body.name === "string" && body.name !== "" ? body.name : basename(target);
        if (kind === "image") {
          setProgress(token, { stage: "image", detail: "正在调用多模态模型识别图片...", done: 0, total: 1 });
          const text = await describeImageCached(ctx, cfg, target, void 0);
          const parsedPath = await writeParsedMarkdown(cwd, target, text, srcName);
          setProgress(token, { stage: "image", detail: "识别完成", done: 1, total: 1 });
          return writeJson(res, 200, { ok: true, kind: "image", text, parsedPath, path: target });
        }
        if (kind === "text") {
          setProgress(token, { stage: "text", detail: "正在读取文本文件...", done: 0, total: 1 });
          const result = await processText(ctx, cfg, cwd, target, basename(target));
          const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName);
          setProgress(token, { stage: "text", detail: "读取完成", done: 1, total: 1 });
          return writeJson(res, 200, { ok: true, kind: "text", parsedPath, ...result, path: target });
        }
        if (kind === "doc") {
          setProgress(token, { stage: "doc", detail: "正在解析文件...", done: 0, total: 1 });
          const result = await processDocument(ctx, cfg, cwd, target, basename(target), void 0, (patch) => setProgress(token, patch));
          const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName);
          setProgress(token, { stage: "doc", detail: "解析完成", done: 1, total: 1 });
          return writeJson(res, 200, { ok: true, kind: "doc", parsedPath, ...result, path: target });
        }
        try {
          setProgress(token, { stage: "text", detail: "正在解析文件...", done: 0, total: 1 });
          const result = await processText(ctx, cfg, cwd, target, basename(target));
          const parsedPath = await writeParsedMarkdown(cwd, target, result.markdown, srcName);
          setProgress(token, { stage: "text", detail: "解析完成", done: 1, total: 1 });
          return writeJson(res, 200, { ok: true, kind: "text", parsedPath, ...result, path: target, note: "未知格式，已按文本读取。" });
        } catch (error) {
          const stat = await fs.stat(target).catch(() => void 0);
          return writeJson(res, 200, {
            ok: true,
            kind: "other",
            path: target,
            size: stat?.size,
            note: messageOf(error) || "无法解析该文件"
          });
        }
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) || "解析失败" });
      } finally {
        clearProgress(token);
      }
    }
  }), "dsh-omnifile.process");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/status",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const token = url.searchParams.get("token") ?? "";
        const entry = typeof token === "string" && token !== "" ? progressStore.get(token) : void 0;
        return writeJson(res, 200, { ok: true, progress: entry ?? null });
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.status");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/parsed",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const cwd = await sessionCwd(ctx, sessionId);
        const rawPath = url.searchParams.get("path") ?? "";
        const target = assertWorkspacePath(cwd, rawPath);
        const parsedPath = target.toLowerCase().endsWith(".md") ? target : parsedMarkdownPath(cwd, target);
        const data = await fs.readFile(parsedPath);
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-length": data.length,
          "cache-control": "no-store"
        });
        res.end(data);
      } catch (error) {
        writeJson(res, 404, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.parsed");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/models",
    handler: async (req, res) => {
      try {
        const providers = await enumerateModels(ctx);
        return writeJson(res, 200, { ok: true, providers });
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.models");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/open",
    handler: async (req, res) => {
      try {
        const body = await readJsonBody(req);
        const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
        const cwd = await sessionCwd(ctx, sessionId);
        const target = assertWorkspacePath(cwd, body.path);
        const result = await openLocally(target);
        return writeJson(res, result.ok ? 200 : 500, { ok: result.ok, error: result.error });
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.open");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/list",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const cwd = await sessionCwd(ctx, sessionId);
        const cfg = getConfig();
        const files = await walkWorkspaceFiles(cwd, {
          maxFiles: cfg.listMaxFiles,
          maxDepth: cfg.listMaxDepth
        });
        return writeJson(res, 200, { ok: true, files });
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.list");
  ctx.effect(() => webServer.register({
    kind: "exact",
    path: "/api/omnifile/config",
    handler: async (req, res) => {
      try {
        const cfg = getConfig();
        return writeJson(res, 200, {
          ok: true,
          config: cfg,
          limits: {
            maxFileBytes: Math.max(1, Number(cfg.maxFileBytes) || MAX_SAVE_FALLBACK_BYTES),
            maxBatchImages: Math.max(1, Number(cfg.maxBatchImages) || 20),
            progressPollMs: Math.max(50, Number(cfg.progressPollMs) || 400),
            listMaxFiles: Math.max(1, Number(cfg.listMaxFiles) || 2e3),
            listMaxDepth: Math.max(1, Number(cfg.listMaxDepth) || 12)
          }
        });
      } catch (error) {
        return writeJson(res, 500, { ok: false, error: messageOf(error) });
      }
    }
  }), "dsh-omnifile.config");
}
function registerTool(ctx, getConfig) {
  const tools = ctx.get("tools");
  if (tools === void 0) return;
  ctx.effect(() => tools.register(defineTool({
    name: "dshomnifile",
    description: "分析本地文件并把解析结果落盘为 {源文件名}.md，返回一行可读路径引用（解析后保存路径：<md绝对路径>（完整内容见上方文件卡片，可点击展开；源文件：<源文件绝对路径>））；如解析失败/无法读取则返回「解析后保存路径：<源路径>（解析失败/无法按文本读取：原因）」。拿到 md 路径后用内置 read 工具即可读取完整内容。支持的类型与行为：\n1）图片（.png/.jpg/.jpeg/.webp/.gif/.bmp/.svg/.avif）：交给配置的多模态模型识别为文字描述并写入 md；同一张图片的结果按内容哈希缓存，不会重复调用多模态服务。若当前模型本身支持 image 输入，直接用 read_image 查看原图更合适（避免重复处理），dshomnifile 的图片模式适合文本-only 模型或需逐字转写的场景。\n2）文档（.doc/.docx/.docm/.odt/.pdf/.ppt/.pptx/.rtf/.epub/.xlsx/.ods/.odp/.csv 及 .pps/.pot/.pptm/.ppsx/.ppsm/.xls/.xlsm/.xlsb 等变体）：用 @firecrawl/anydoc 转为 GitHub-Flavored Markdown 并识别内嵌图片，写入 md；纯扫描/图像型 PDF 会用 PyMuPDF 逐页渲染识别并按页序拼装。\n3）文本（.json/.txt/.md/.html/.shtml）：直接以 UTF-8/GB18030 解码为文字（JSON 美化、HTML 剥标签），写入 md。\n4）其它（音视频等二进制）：无法按文本读取时返回路径与原因（保留大小等元信息）。\n5）说明：需先通过「设置-模型」配置一个支持 image 输入的多模态模型并在此插件设置里选择它，否则图片/文档内嵌图片识别会报错。",
    parameters: {
      filePath: { type: "string", required: true, description: "要分析的文件的绝对路径" },
      prompt: { type: "string", description: "可选，指定识图时的关注点（仅图片与文档内嵌图片生效）" },
      kind: { type: "string", description: "可选，显式指定类别（image/doc/text/media/other）；缺省按扩展名推断" }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    isConcurrencySafe: () => true,
    /* 工具与聊天卡片同一套「解析→落盘 {源文件名}.md→给一行可读路径引用」：不把解析全文塞进模型上下文，
     * 模型拿到 md 绝对路径后用内置 read 工具即可读到内容。返回统一为：
     *   解析后保存路径：<md 或源路径>（完整内容见上方文件卡片，可点击展开；源文件：<源路径> | 无法按文本读取：… | 解析失败：…）
     */
    async execute(args, exec) {
      const path = String(args?.filePath ?? "").trim();
      if (path === "") throw new Error("filePath 不能为空");
      const cfg = getConfig();
      const kind = String(args?.kind ?? "").trim() || fileKind(path);
      const prompt = typeof args?.prompt === "string" && args.prompt !== "" ? args.prompt : void 0;
      let cwd = "";
      try {
        cwd = agentCwd(exec);
      } catch (error) {
        cwd = "";
      }
      const saveMarkdown = async (markdown) => {
        if (cwd === "") return void 0;
        try {
          return await writeParsedMarkdown(cwd, path, markdown);
        } catch (error) {
          return void 0;
        }
      };
      const ok = async (markdown) => {
        const mdPath = await saveMarkdown(markdown);
        return markerText(mdPath || path, { ok: true, source: path });
      };
      const unreadable = (note) => markerText(path, { note });
      try {
        const stat = await fs.stat(path);
        if (!stat.isFile()) throw new Error("不是有效文件");
        if (kind === "image") {
          const text = await describeImageCached(ctx, cfg, path, prompt);
          return await ok(text);
        }
        if (kind === "text") {
          const result = await processText(ctx, cfg, cwd, path, basename(path));
          return await ok(result.markdown);
        }
        if (kind === "doc") {
          const result = await processDocument(ctx, cfg, cwd, path, basename(path));
          const full = result.markdown + (result.images.length > 0 ? "\n\n【文档内嵌图片识别结果】\n" + result.images.map((img) => img.error !== void 0 ? "- 图片 " + img.name + "：识别失败（" + img.error + "）" : "- 图片 " + img.name + "：" + img.description).join("\n") : "");
          return await ok(full);
        }
        try {
          const result = await processText(ctx, cfg, cwd, path, basename(path));
          return await ok(result.markdown);
        } catch (error) {
          const statInfo = await fs.stat(path).catch(() => void 0);
          return unreadable(messageOf(error) + (statInfo ? "（" + statInfo.size + " 字节）" : ""));
        }
      } catch (error) {
        return markerText(path, { ok: false, note: messageOf(error) || MARKER_UNKNOWN });
      }
    }
  })), "dsh-omnifile.tool");
}
function shouldWrapModel(info) {
  return Array.isArray(info?.inputModalities) && !info.inputModalities.includes("image");
}
function lastUserQuestion(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content;
    const text = Array.isArray(content) ? content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n") : typeof content === "string" ? content : "";
    const trimmed = text.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}
class OmnifileVariantAdapter extends LlmAdapter {
  ctx;
  llm;
  upstream;
  upstreamName;
  getConfig;
  constructor(ctx, llm, upstream, upstreamName, getConfig) {
    super();
    this.ctx = ctx;
    this.llm = llm;
    this.upstream = upstream;
    this.upstreamName = upstreamName;
    this.getConfig = getConfig;
  }
  providerInfo(provider) {
    return { id: provider, name: this.upstreamName + VARIANT_SUFFIX };
  }
  async listModels(provider, signal) {
    const models = await this.llm.listModels(this.upstream, signal);
    return models.filter((m) => shouldWrapModel(m)).map((m) => ({
      provider,
      id: m.id,
      name: m.name + VARIANT_SUFFIX,
      inputModalities: ["text", "image"],
      ...m.description !== void 0 ? { description: m.description } : {}
    }));
  }
  async resolveModel(provider, model, signal) {
    const info = await this.llm.resolveModelInfo(this.upstream, model, signal);
    if (!shouldWrapModel(info)) throw new Error('model "' + model + '" is not text-only; no omnifile variant needed');
    return {
      provider,
      id: model,
      name: info.name + VARIANT_SUFFIX,
      inputModalities: ["text", "image"],
      ...info.description !== void 0 ? { description: info.description } : {},
      ...info.context !== void 0 ? { context: info.context } : {},
      ...info.defaultMaxTokens !== void 0 ? { defaultMaxTokens: info.defaultMaxTokens } : {},
      ...info.reasoning !== void 0 ? { reasoning: info.reasoning } : {}
    };
  }
  async *stream(options) {
    const cfg = this.getConfig();
    const messages = await this.rewriteMessages(cfg, options.messages, options.signal, options.sessionId);
    yield* this.llm.stream({ ...options, provider: this.upstream, messages });
  }
  async rewriteMessages(cfg, messages, signal, sessionId) {
    if (!messages.some((message) => contentHasImage(message.content))) return messages;
    const limit = createLimiter(cfg.concurrency || 1);
    const question = lastUserQuestion(messages);
    const out = [];
    for (const message of messages) {
      if (!contentHasImage(message.content)) {
        out.push(message);
        continue;
      }
      const content = await this.convertBlocks(cfg, message.content, limit, signal, sessionId, question);
      out.push({ ...message, content });
    }
    return out;
  }
  async convertBlocks(cfg, blocks, limit, signal, sessionId, question) {
    const result = [];
    let channelInserted = false;
    for (const block of blocks) {
      if (block.type === "tool-result" && contentHasImage(block.content)) {
        const nested = await this.convertBlocks(cfg, block.content, limit, signal, sessionId, question);
        result.push({ ...block, content: nested });
        continue;
      }
      if (block.type !== "image") {
        result.push(block);
        continue;
      }
      if (!channelInserted) {
        result.push({
          type: "text",
          text: "[dshomnifile] 这里的图片已经由多模态模型转换成文字说明，你只收到描述文本，不包含视觉 Token；图片绝对路径一并附上，需要更多视觉证据时可读该路径。"
        });
        channelInserted = true;
      }
      signal?.throwIfAborted();
      const replacement = await limit(async () => {
        try {
          const attachment = this.ctx.get("attachments");
          const cwd = typeof sessionId === "string" && sessionId !== "" ? this.ctx.sessions.get(sessionId)?.header?.cwd : void 0;
          const pathEvidence = await this.materializeAsEvidence(block, attachment, cwd);
          const basePrompt = cfg.describePrompt || DEFAULT_DESCRIBE_PROMPT;
          const questionText = typeof question === "string" ? question.trim().slice(0, 600) : "";
          const describePrompt = questionText !== "" ? basePrompt + "\n\n用户的问题是：「" + questionText + "」。请围绕该问题重点描述图片中相关的关键细节（文字、数据、界面元素等），以供一个无法看到图片的模型回答问题。" : basePrompt;
          const description = await describeImageCached(this.ctx, cfg, pathEvidence.path, describePrompt);
          return {
            type: "text",
            text: "图片绝对路径: " + JSON.stringify(pathEvidence.path) + "\n多模态模型描述： " + description
          };
        } catch (error) {
          return { type: "text", text: "[dshomnifile 不可用] " + messageOf(error).slice(0, 300) };
        }
      });
      result.push(replacement);
    }
    return result;
  }
  async materializeAsEvidence(block, attachmentService, cwd) {
    if (attachmentService === void 0) throw new Error("附件服务不可用");
    const stored = await attachmentService.readImage(block.attachment);
    const data = stored?.data;
    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) throw new Error("无法读取附件图片字节");
    const ext = extnameOfMedia(block.attachment?.mediaType || "");
    const hash = createHash("sha256").update(String(block.attachment?.attachmentId ?? "")).digest("hex").slice(0, 16);
    if (typeof cwd === "string" && cwd !== "") {
      const imagesDir = uploadsImagesDir(cwd);
      await fs.mkdir(imagesDir, { recursive: true });
      const path2 = join(imagesDir, "attachment-" + hash + ext);
      await fs.writeFile(path2, Buffer.from(data));
      return { path: path2 };
    }
    const tmp = process.env.TEMP || process.env.TMP || "/tmp";
    const path = join(tmp, "omnifile-" + hash + ext);
    await fs.writeFile(path, Buffer.from(data));
    return { path };
  }
}
function installVariants(ctx, getConfig) {
  const registrations = /* @__PURE__ */ new Map();
  let disposed = false;
  let sweeping = Promise.resolve();
  let sweepQueued = false;
  const releaseAll = () => {
    for (const dispose of [...registrations.values()]) dispose();
    registrations.clear();
  };
  const sweep = () => {
    if (sweepQueued) return;
    sweepQueued = true;
    queueMicrotask(() => {
      sweepQueued = false;
      sweeping = sweeping.then(sweepOnce, sweepOnce);
    });
  };
  const sweepOnce = async () => {
    if (disposed) return;
    try {
      const cfg = getConfig();
      if (cfg.enableVariants !== true) {
        releaseAll();
        return;
      }
      const llm = ctx.get("llm");
      if (llm === void 0) return;
      let providers;
      try {
        providers = llm.listProviders();
      } catch {
        return;
      }
      const live = new Set(providers.map((provider) => provider.id));
      for (const upstream of [...registrations.keys()]) {
        if (!live.has(upstream)) {
          registrations.get(upstream)?.();
          registrations.delete(upstream);
        }
      }
      for (const provider of providers) {
        const upstream = provider.id;
        if (upstream.startsWith(VARIANT_PREFIX)) continue;
        if (registrations.has(upstream)) continue;
        let models;
        try {
          models = await llm.listModels(upstream);
        } catch {
          continue;
        }
        if (!models.some((model) => shouldWrapModel(model))) continue;
        if (disposed) return;
        try {
          const dispose = llm.registerAdapter(
            [VARIANT_PREFIX + upstream],
            new OmnifileVariantAdapter(ctx, llm, upstream, provider.name, getConfig)
          );
          registrations.set(upstream, dispose);
        } catch (error) {
          ctx.logger?.warn?.(LOG_PREFIX + ' variant registration skipped for "' + upstream + '": ' + messageOf(error));
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(LOG_PREFIX + " variant sweep failed: " + messageOf(error));
    }
  };
  if (typeof ctx.on === "function") ctx.on("llm/adapters-updated", () => sweep());
  sweep();
  return () => {
    disposed = true;
    releaseAll();
  };
}
const name = "dsh-omnifile";
const inject = ["webServer", "sessions", "tools", "settings", "credentials", "llm"];
function loadConfig(ctx) {
  let stored;
  try {
    stored = ctx.settings ? ctx.settings.get(NAMESPACE) : void 0;
  } catch {
    stored = void 0;
  }
  return stored !== void 0 && stored !== null && typeof stored === "object" ? stored : {};
}
function apply(ctx, config = {}) {
  const forced = { ...config };
  if (typeof ctx.settings?.register === "function") {
    ctx.settings.register(NAMESPACE, Config, { base: forced, applies: "live" });
  }
  const getConfig = () => {
    const stored = loadConfig(ctx);
    if (Object.keys(stored).length > 0) {
      return { ...forced, ...stored };
    }
    return forced;
  };
  syncRunLimits(getConfig());
  let disposeVariants = () => {
  };
  try {
    if (ctx.get("llm") !== void 0) disposeVariants = installVariants(ctx, getConfig);
  } catch (error) {
    ctx.logger?.warn?.(LOG_PREFIX + " variants skipped: " + messageOf(error));
  }
  registerRoutes(ctx, getConfig);
  registerTool(ctx, getConfig);
  return () => {
    disposeVariants();
  };
}
export {
  Config,
  apply,
  inject,
  name
};
