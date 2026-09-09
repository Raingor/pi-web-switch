import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Download, Eye, EyeOff, ExternalLink, Film, Image as ImageIcon, KeyRound, Loader2, MessageSquare, Send, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shape returned by /api/pi/image-generate, /video-create and /video-status
// (see server/pi-reader.ts GenerateResult).
interface GenerateResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  images?: string[];
  videoId?: string;
  taskStatus?: string;
  progress?: number;
  videoUrl?: string;
  retryable?: boolean;
}

interface AgnesConfigView {
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string;
}

// Documented tiers/ratios for the images endpoint.
const IMAGE_MODELS = ["agnes-image-2.5-flash", "agnes-image-2.1-flash"] as const;
const IMAGE_SIZES = ["1K", "2K", "3K", "4K"] as const;
const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
// Videos: Flash tiers only accept 720P, so size is fixed and only ratio varies.
const VIDEO_MODELS = ["agnes-video-2.5-flash", "agnes-video-2.5"] as const;
const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
// Agnes currently rejects durations outside its 4–12 second range.
const VIDEO_SECONDS = ["5", "10", "12"] as const;
const VIDEO_MODES = [
  { value: "text", label: "文生视频" },
  { value: "keyframe", label: "首尾帧控制" },
  { value: "reference", label: "图片/音频参考" },
] as const;

// The status endpoint rate-limits below ~5s, so poll slower than the docs suggest.
const POLL_INTERVAL_MS = 8000;
const DONE_STATES = /^(completed|succeeded|success)$/i;
const FAILED_STATES = /^(failed|error|cancelled|canceled)$/i;
const AGNES_MODEL = "agnes-3.0-flash";
const AGNES_DOCS = "https://agnes-ai.com/zh-Hans/docs/agnes-30-flash.md";

type MessageContent = string | Array<
  { type: "text"; text: string } |
  { type: "image_url"; image_url: { url: string } }
>;
type ChatMessage = { role: "system" | "user" | "assistant"; content: MessageContent; imageUrl?: string };
interface ChatResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  reply?: string;
  usage?: { totalTokens?: number };
}

function messageText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\\n");
}

const inputCls =
  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-blue-500";
const labelCls = "mb-1.5 block text-xs font-medium text-gray-400";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-600">{hint}</span>}
    </label>
  );
}

/** Split a textarea of one-per-line URLs into a clean list. */
function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

interface LocalImageReference {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
}

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const VIDEO_REFERENCE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readImageAsDataUrl(file: File): Promise<LocalImageReference> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`无法读取 ${file.name}`));
        return;
      }
      resolve({
        id: `${file.name}:${file.size}:${file.lastModified}`,
        name: file.name,
        dataUrl: reader.result,
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function GeneratePage() {
  const [tab, setTab] = useState<"image" | "video" | "chat">("image");

  // ── Agnes credentials ──
  // The key is stored server-side in ~/.pi/agent/agnes-config.json (0600) and
  // never sent back to the browser, so requests below carry no credentials.
  const [config, setConfig] = useState<AgnesConfigView | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyError, setKeyError] = useState("");

  const loadConfig = () => {
    fetch("/api/pi/agnes-config")
      .then((res) => res.json())
      .then((data: AgnesConfigView) => setConfig(data))
      .catch(() => setConfig({ baseUrl: "", hasKey: false, maskedKey: "" }));
  };
  useEffect(loadConfig, []);

  const saveKey = async () => {
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    setSavingKey(true);
    setKeyError("");
    try {
      const res = await fetch("/api/pi/agnes-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await res.json()) as { success: boolean };
      if (!data.success) throw new Error();
      setKeyDraft("");
      setKeySaved(true);
      window.setTimeout(() => setKeySaved(false), 2000);
      loadConfig();
    } catch {
      setKeyError("保存失败");
    } finally {
      setSavingKey(false);
    }
  };

  const ready = !!config?.hasKey;

  // ── Agnes 3.0 Flash chat state ──
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatSystemPrompt, setChatSystemPrompt] = useState("");
  const [chatImageUrl, setChatImageUrl] = useState("");
  const [chatMaxTokens, setChatMaxTokens] = useState("1024");
  const [chatTemperature, setChatTemperature] = useState("0.7");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatMeta, setChatMeta] = useState<{ latencyMs?: number; totalTokens?: number } | null>(null);

  const sendChat = async () => {
    const text = chatPrompt.trim();
    if (!ready || !text || chatBusy) return;
    setChatBusy(true);
    setChatError("");
    const content: MessageContent = chatImageUrl.trim()
      ? [{ type: "text", text }, { type: "image_url", image_url: { url: chatImageUrl.trim() } }]
      : text;
    const userMessage: ChatMessage = { role: "user", content, imageUrl: chatImageUrl.trim() || undefined };
    const history = [
      ...(chatSystemPrompt.trim() ? [{ role: "system" as const, content: chatSystemPrompt.trim() }] : []),
      ...chatMessages.map(({ role, content: value }) => ({ role, content: value })),
      userMessage,
    ];
    setChatMessages((previous) => [...previous, userMessage]);
    setChatPrompt("");
    setChatImageUrl("");
    try {
      const res = await fetch("/api/pi/agnes-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: AGNES_MODEL,
          messages: history,
          maxTokens: Number(chatMaxTokens) || 1024,
          temperature: Number(chatTemperature),
        }),
      });
      const result = (await res.json()) as ChatResult;
      if (!result.success || !result.reply) {
        setChatError(`${result.status ? `HTTP ${result.status}：` : ""}${result.message || "请求失败"}`);
        setChatMessages((previous) => previous.slice(0, -1));
        return;
      }
      setChatMessages((previous) => [...previous, { role: "assistant", content: result.reply! }]);
      setChatMeta({ latencyMs: result.latencyMs, totalTokens: result.usage?.totalTokens });
    } catch {
      setChatError("请求失败，请检查开发服务器或网络连接");
      setChatMessages((previous) => previous.slice(0, -1));
    } finally {
      setChatBusy(false);
    }
  };

  // ── Image state ──
  const [imageModel, setImageModel] = useState<string>(IMAGE_MODELS[0]);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<string>("1K");
  const [imageRatio, setImageRatio] = useState<string>("1:1");
  const [imageFormat, setImageFormat] = useState<"url" | "b64_json">("url");
  const [imageRefs, setImageRefs] = useState("");
  const [localImageRefs, setLocalImageRefs] = useState<LocalImageReference[]>([]);
  const [imageRefError, setImageRefError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageResult, setImageResult] = useState<GenerateResult | null>(null);

  // ── Video state ──
  const [videoModel, setVideoModel] = useState<string>(VIDEO_MODELS[0]);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoMode, setVideoMode] = useState<"text" | "keyframe" | "reference">("text");
  const [videoSeconds, setVideoSeconds] = useState<string>("5");
  const [videoRatio, setVideoRatio] = useState<string>("16:9");
  const [firstFrame, setFirstFrame] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [videoImages, setVideoImages] = useState("");
  const [localVideoImages, setLocalVideoImages] = useState<LocalImageReference[]>([]);
  const [videoImageError, setVideoImageError] = useState("");
  const videoImageInputRef = useRef<HTMLInputElement>(null);
  const [videoAudios, setVideoAudios] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<GenerateResult | null>(null);
  const pollTimer = useRef<number | null>(null);

  const addLocalImageFiles = async (files: File[]) => {
    setImageRefError("");
    const validFiles = files.filter((file) => file.type.startsWith("image/"));
    if (validFiles.length !== files.length) setImageRefError("只能添加图片文件");
    const oversized = validFiles.find((file) => file.size > MAX_REFERENCE_IMAGE_BYTES);
    if (oversized) setImageRefError(`${oversized.name} 超过 20 MB，未添加`);
    const readable = validFiles.filter((file) => file.size <= MAX_REFERENCE_IMAGE_BYTES);
    if (readable.length === 0) return;
    try {
      const loaded = await Promise.all(readable.map(readImageAsDataUrl));
      setLocalImageRefs((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...loaded.filter((item) => !existing.has(item.id))];
      });
    } catch (error) {
      setImageRefError(error instanceof Error ? error.message : "读取图片失败");
    }
  };

  const imageReferenceValues = [
    ...parseLines(imageRefs),
    ...localImageRefs.map((image) => image.dataUrl),
  ];

  const addLocalVideoImageFiles = async (files: File[]) => {
    setVideoImageError("");
    const validFiles = files.filter((file) => VIDEO_REFERENCE_IMAGE_TYPES.has(file.type));
    if (validFiles.length !== files.length) setVideoImageError("视频参考图仅支持 JPEG、PNG、WEBP");
    const oversized = validFiles.find((file) => file.size > MAX_REFERENCE_IMAGE_BYTES);
    if (oversized) setVideoImageError(`${oversized.name} 超过 20 MB，未添加`);
    const readable = validFiles.filter((file) => file.size <= MAX_REFERENCE_IMAGE_BYTES);
    if (readable.length === 0) return;
    try {
      const loaded = await Promise.all(readable.map(readImageAsDataUrl));
      setLocalVideoImages((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...loaded.filter((item) => !existing.has(item.id))];
      });
    } catch (error) {
      setVideoImageError(error instanceof Error ? error.message : "读取图片失败");
    }
  };

  const videoReferenceValues = [
    ...parseLines(videoImages),
    ...localVideoImages.map((image) => image.dataUrl),
  ];

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const runImage = async () => {
    if (!ready || !imageModel.trim() || !imagePrompt.trim()) return;
    setImageBusy(true);
    setImageResult(null);
    try {
      const res = await fetch("/api/pi/image-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: imageModel.trim(),
          prompt: imagePrompt.trim(),
          size: imageSize,
          ratio: imageRatio,
          responseFormat: imageFormat,
          image: imageReferenceValues,
        }),
      });
      setImageResult((await res.json()) as GenerateResult);
    } catch {
      setImageResult({ success: false, message: "请求失败，请检查开发服务器是否在运行" });
    } finally {
      setImageBusy(false);
    }
  };

  /** Poll one task tick, then reschedule until it finishes or fails hard. */
  const pollVideo = (videoId: string, model: string) => {
    const params = new URLSearchParams({ videoId, model });
    pollTimer.current = window.setTimeout(async () => {
      let next: GenerateResult;
      try {
        const res = await fetch(`/api/pi/video-status?${params}`);
        next = (await res.json()) as GenerateResult;
      } catch {
        // Network blip — keep the task alive and try again.
        pollVideo(videoId, model);
        return;
      }
      // Rate limits and gateway errors are transient; keep showing progress.
      if (!next.success && next.retryable) {
        setVideoResult((prev) => ({ ...(prev ?? {}), ...next, success: true, message: undefined }));
        pollVideo(videoId, model);
        return;
      }
      setVideoResult(next);
      const finished =
        !!next.videoUrl ||
        !next.success ||
        FAILED_STATES.test(next.taskStatus ?? "") ||
        DONE_STATES.test(next.taskStatus ?? "");
      if (finished) {
        setVideoBusy(false);
        stopPolling();
        return;
      }
      pollVideo(videoId, model);
    }, POLL_INTERVAL_MS);
  };

  const runVideo = async () => {
    if (!ready || !videoModel.trim() || !videoPrompt.trim()) return;
    stopPolling();
    setVideoBusy(true);
    setVideoResult(null);
    const model = videoModel.trim();
    try {
      const res = await fetch("/api/pi/video-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: videoPrompt.trim(),
          mode: videoMode,
          seconds: videoSeconds,
          size: "720P",
          aspectRatio: videoRatio,
          firstFrame: videoMode === "keyframe" ? firstFrame.trim() : undefined,
          lastFrame: videoMode === "keyframe" ? lastFrame.trim() : undefined,
          images: videoMode === "reference" ? videoReferenceValues : undefined,
          audios: videoMode === "reference" ? parseLines(videoAudios) : undefined,
        }),
      });
      const created = (await res.json()) as GenerateResult;
      setVideoResult(created);
      if (created.success && created.videoId) {
        pollVideo(created.videoId, model);
      } else {
        setVideoBusy(false);
      }
    } catch {
      setVideoResult({ success: false, message: "请求失败，请检查开发服务器是否在运行" });
      setVideoBusy(false);
    }
  };

  return (
    <div className="skills-page" style={{ maxWidth: 960 }}>
      <header className="skills-page-heading">
        <div className="skills-page-mark">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="skills-page-kicker">AGNES GENERATION</p>
          <h1>生图 / 生视频</h1>
          <p>Agnes AI 专区，填入一个 API Key 即可生成。与提供商与模型页面的聊天配置互不影响。</p>
        </div>
      </header>

      {/* ── Agnes API Key ── */}
      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-gray-200">Agnes API Key</h2>
          {config?.hasKey ? (
            <span className="rounded-full border border-emerald-800 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
              {config.maskedKey}
            </span>
          ) : (
            <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-500">未配置</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={config?.hasKey ? "输入新 Key 以替换" : "sk-…"}
              autoComplete="off"
              className={cn(inputCls, "pr-10 font-mono")}
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => !prev)}
              title={showKey ? "隐藏" : "显示"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={saveKey}
            disabled={savingKey || !keyDraft.trim()}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : keySaved ? <Check className="h-4 w-4 text-emerald-400" /> : null}
            {keySaved ? "已保存" : "保存"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">
          保存到 ~/.pi/agent/agnes-config.json（权限 0600），仅服务端读取，不会回传浏览器。端点 {config?.baseUrl || "—"}
        </p>
        {keyError && <p className="mt-1 text-xs text-red-400">{keyError}</p>}
      </div>

      <div className="mb-4 flex gap-2">
        {([
          { key: "image", icon: ImageIcon, label: "图片" },
          { key: "video", icon: Film, label: "视频" },
          { key: "chat", icon: MessageSquare, label: "Agnes 3.0" },
        ] as const).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-gray-600 bg-gray-800 text-white"
                : "border-gray-700 text-gray-400 hover:bg-gray-800/60 hover:text-gray-200",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "image" ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="模型">
                <input list="agnes-image-models" value={imageModel} onChange={(e) => setImageModel(e.target.value)} className={cn(inputCls, "font-mono")} />
                <datalist id="agnes-image-models">
                  {IMAGE_MODELS.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </Field>
              <Field label="返回格式">
                <select
                  value={imageFormat}
                  onChange={(e) => setImageFormat(e.target.value as "url" | "b64_json")}
                  className={inputCls}
                >
                  <option value="url">图片 URL</option>
                  <option value="b64_json">Base64</option>
                </select>
              </Field>
            </div>
            <Field label="提示词">
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={3}
                placeholder="主体 + 场景 / 环境 + 风格 + 光照 + 构图 + 质量要求"
                className={cn(inputCls, "resize-y")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="尺寸档位">
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className={inputCls}>
                  {IMAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="宽高比">
                <select value={imageRatio} onChange={(e) => setImageRatio(e.target.value)} className={inputCls}>
                  {IMAGE_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="参考图（可选）" hint="支持 URL、data URI 或本地图片；多张图片会一起发送用于图生图 / 多图合成">
              <div className="space-y-2">
                <textarea
                  value={imageRefs}
                  onChange={(e) => setImageRefs(e.target.value)}
                  rows={2}
                  placeholder="每行一个公开图片 URL，例如 https://example.com/input.png"
                  className={cn(inputCls, "resize-y font-mono text-xs")}
                />
                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void addLocalImageFiles(Array.from(event.dataTransfer.files));
                  }}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-gray-700 bg-gray-950/40 px-3 py-3 transition-colors hover:border-blue-500/70 hover:bg-blue-950/10"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ImageIcon className="h-4 w-4 shrink-0 text-blue-400" />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-300">从本地选择或拖拽图片到这里</p>
                      <p className="text-[11px] text-gray-600">PNG、JPG、WEBP · 单张不超过 20 MB · 可多选</p>
                    </div>
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      void addLocalImageFiles(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-blue-800/70 px-3 py-1.5 text-xs text-blue-300 transition-colors hover:bg-blue-950/50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    选择图片
                  </button>
                </div>
                {localImageRefs.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {localImageRefs.map((image) => (
                      <div key={image.id} className="group relative overflow-hidden rounded-lg border border-gray-700 bg-gray-950/60">
                        <img src={image.dataUrl} alt={image.name} className="aspect-[4/3] w-full object-cover" />
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                          <span className="min-w-0 truncate text-[10px] text-gray-400" title={image.name}>{image.name}</span>
                          <span className="shrink-0 text-[10px] text-gray-600">{formatFileSize(image.size)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLocalImageRefs((previous) => previous.filter((item) => item.id !== image.id))}
                          className="absolute right-1.5 top-1.5 rounded-md bg-gray-950/80 p-1 text-gray-300 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                          title={`移除 ${image.name}`}
                          aria-label={`移除 ${image.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
                  <span>已添加 {imageReferenceValues.length} 张参考图</span>
                  {imageRefError && <span className="text-red-400">{imageRefError}</span>}
                </div>
              </div>
            </Field>
            <button
              onClick={runImage}
              disabled={imageBusy || !ready || !imagePrompt.trim() || !imageModel.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {imageBusy ? "生成中…（可能需要数十秒）" : ready ? "生成图片" : "请先保存 API Key"}
            </button>
          </div>

          {imageResult && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              {imageResult.success ? (
                <>
                  <p className="mb-3 text-xs text-gray-500">
                    生成成功 · {imageResult.latencyMs ?? 0}ms · {imageResult.images?.length ?? 0} 张
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(imageResult.images ?? []).map((src, index) => (
                      <figure key={index} className="overflow-hidden rounded-lg border border-gray-700">
                        <img src={src} alt={`生成结果 ${index + 1}`} className="w-full" />
                        <figcaption className="flex items-center justify-between gap-2 bg-gray-900 px-3 py-2">
                          <span className="truncate font-mono text-[11px] text-gray-500">{src.slice(0, 48)}…</span>
                          <a
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="flex shrink-0 items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            <Download className="h-3.5 w-3.5" />
                            打开
                          </a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-red-400">
                  生成失败{imageResult.status ? `（HTTP ${imageResult.status}）` : ""}：{imageResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      ) : tab === "video" ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="模型">
                <input list="agnes-video-models" value={videoModel} onChange={(e) => setVideoModel(e.target.value)} className={cn(inputCls, "font-mono")} />
                <datalist id="agnes-video-models">
                  {VIDEO_MODELS.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </Field>
              <Field label="生成模式">
                <select
                  value={videoMode}
                  onChange={(e) => setVideoMode(e.target.value as typeof videoMode)}
                  className={inputCls}
                >
                  {VIDEO_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="提示词" hint="参考模式可用 <Picture 1> / <Audio 1> 指代素材">
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={3}
                placeholder="画面内容、镜头运动、光照氛围"
                className={cn(inputCls, "resize-y")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="时长（秒）">
                <select value={videoSeconds} onChange={(e) => setVideoSeconds(e.target.value)} className={inputCls}>
                  {VIDEO_SECONDS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="宽高比">
                <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)} className={inputCls}>
                  {VIDEO_RATIOS.map((ratio) => (
                    <option key={ratio} value={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="分辨率" hint="Flash 档位固定 720P">
                <input value="720P" readOnly className={cn(inputCls, "cursor-not-allowed text-gray-500")} />
              </Field>
            </div>

            {videoMode === "keyframe" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="首帧图片 URL" hint="首帧与尾帧至少填一个">
                  <input value={firstFrame} onChange={(e) => setFirstFrame(e.target.value)} className={inputCls} />
                </Field>
                <Field label="尾帧图片 URL">
                  <input value={lastFrame} onChange={(e) => setLastFrame(e.target.value)} className={inputCls} />
                </Field>
              </div>
            )}

            {videoMode === "reference" && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="参考图片（最多 5 张）" hint="支持 URL、data URI、本地选择或拖拽图片">
                  <div className="space-y-2">
                    <textarea
                      value={videoImages}
                      onChange={(e) => setVideoImages(e.target.value)}
                      rows={3}
                      placeholder="每行一个图片 URL"
                      className={cn(inputCls, "resize-y font-mono text-xs")}
                    />
                    <div
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        void addLocalVideoImageFiles(Array.from(event.dataTransfer.files));
                      }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-950/40 px-3 py-2.5 hover:border-blue-500/70 hover:bg-blue-950/10"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ImageIcon className="h-4 w-4 shrink-0 text-blue-400" />
                        <span className="truncate text-[11px] text-gray-500">选择或拖拽本地参考图</span>
                      </div>
                      <input
                        ref={videoImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          void addLocalVideoImageFiles(Array.from(event.target.files ?? []));
                          event.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => videoImageInputRef.current?.click()}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-blue-800/70 px-2.5 py-1.5 text-[11px] text-blue-300 hover:bg-blue-950/50"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        上传图片
                      </button>
                    </div>
                    {localVideoImages.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {localVideoImages.map((image) => (
                          <div key={image.id} className="group relative overflow-hidden rounded-lg border border-gray-700 bg-gray-950/60">
                            <img src={image.dataUrl} alt={image.name} className="aspect-[4/3] w-full object-cover" />
                            <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                              <span className="min-w-0 truncate text-[10px] text-gray-400" title={image.name}>{image.name}</span>
                              <span className="shrink-0 text-[10px] text-gray-600">{formatFileSize(image.size)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setLocalVideoImages((previous) => previous.filter((item) => item.id !== image.id))}
                              className="absolute right-1.5 top-1.5 rounded-md bg-gray-950/80 p-1 text-gray-300 opacity-0 hover:text-red-300 group-hover:opacity-100"
                              title={`移除 ${image.name}`}
                              aria-label={`移除 ${image.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                      <span>已添加 {videoReferenceValues.length} 张图片</span>
                      {videoImageError && <span className="text-red-400">{videoImageError}</span>}
                    </div>
                  </div>
                </Field>
                <Field label="参考音频（一行一个，最多 3 段）">
                  <textarea
                    value={videoAudios}
                    onChange={(e) => setVideoAudios(e.target.value)}
                    rows={3}
                    className={cn(inputCls, "resize-y font-mono text-xs")}
                  />
                </Field>
              </div>
            )}

            <button
              onClick={runVideo}
              disabled={videoBusy || !ready || !videoPrompt.trim() || !videoModel.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
              {videoBusy ? "生成中…（通常 2–4 分钟）" : ready ? "创建视频任务" : "请先保存 API Key"}
            </button>
          </div>

          {videoResult && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
              {videoResult.success || videoResult.retryable ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {videoResult.videoId && <span className="font-mono">{videoResult.videoId}</span>}
                    <span>状态：{videoResult.taskStatus ?? "已提交"}</span>
                    {typeof videoResult.progress === "number" && <span>{videoResult.progress}%</span>}
                  </div>
                  {videoBusy && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-[width] duration-500"
                        style={{ width: `${Math.max(videoResult.progress ?? 5, 5)}%` }}
                      />
                    </div>
                  )}
                  {videoResult.videoUrl && (
                    <div className="mt-3 space-y-2">
                      <video src={videoResult.videoUrl} controls className="w-full rounded-lg border border-gray-700" />
                      <a
                        href={videoResult.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载视频
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-red-400">
                  任务失败{videoResult.status ? `（HTTP ${videoResult.status}）` : ""}：{videoResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-400" />
                <div>
                  <p className="text-sm font-semibold text-gray-200">Agnes 3.0 Flash</p>
                  <p className="text-[11px] text-gray-500">文本、图像 URL输入 · 512K上下文 · 最大输出 65,536 Token</p>
                </div>
              </div>
              <a href={AGNES_DOCS} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                <BookOpen className="h-3.5 w-3.5" /> 文档 <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex min-h-[220px] flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
              {chatMessages.length === 0 ? (
                <div className="flex min-h-[190px] flex-col items-center justify-center gap-2 text-center text-gray-600">
                  <MessageSquare className="h-7 w-7" />
                  <p className="text-sm">输入任务，开始与 Agnes 3.0 Flash 对话</p>
                  <p className="text-[11px]">支持多轮上下文和图像 URL 输入</p>
                </div>
              ) : chatMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={cn("rounded-lg border px-3 py-2.5", message.role === "user" ? "ml-6 border-blue-900/60 bg-blue-950/20" : "mr-6 border-gray-800 bg-gray-900/70")}>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">{message.role === "user" ? "YOU" : message.role === "system" ? "SYSTEM" : "AGNES 3.0"}</div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{messageText(message.content)}</p>
                  {message.imageUrl && <p className="mt-1 truncate font-mono text-[10px] text-blue-400/70">图片：{message.imageUrl}</p>}
                </div>
              ))}
              {chatBusy && <div className="mr-6 flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2.5 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Agnes 正在思考…</div>}
            </div>
            <Field label="提示词">
              <textarea value={chatPrompt} onChange={(e) => setChatPrompt(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendChat(); }} rows={3} placeholder="描述任务、问题或需要 Agnes 执行的步骤……（⌘/Ctrl + Enter 发送）" className={cn(inputCls, "resize-y")} />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="系统提示词（可选)"><input value={chatSystemPrompt} onChange={(e) => setChatSystemPrompt(e.target.value)} placeholder="定义助手角色和回答风格" className={inputCls} /></Field>
              <Field label="图像 URL（可选）" hint="支持公开可访问的图片 URL"><input value={chatImageUrl} onChange={(e) => setChatImageUrl(e.target.value)} placeholder="https://example.com/image.png" className={cn(inputCls, "font-mono text-xs")} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="最大输出"><input type="number" min="1" max="65536" value={chatMaxTokens} onChange={(e) => setChatMaxTokens(e.target.value)} className={inputCls} /></Field>
                <Field label="温度"><input type="number" min="0" max="2" step="0.1" value={chatTemperature} onChange={(e) => setChatTemperature(e.target.value)} className={inputCls} /></Field>
              </div>
            </div>
            {chatError && <p className="text-sm text-red-400">{chatError}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {chatMeta ? <span className="text-[11px] text-gray-600">本轮完成 · {chatMeta.latencyMs ?? 0}ms{chatMeta.totalTokens ? ` · ${chatMeta.totalTokens.toLocaleString()} tokens` : ""}</span> : <span />}
              <div className="flex items-center gap-3">
                <button onClick={() => { if (!chatBusy) { setChatMessages([]); setChatError(""); setChatMeta(null); } }} disabled={chatBusy || chatMessages.length === 0} className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> 清空对话</button>
                <button onClick={() => void sendChat()} disabled={chatBusy || !ready || !chatPrompt.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                  {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {chatBusy ? "生成中…" : ready ? "发送给 Agnes 3.0" : "请先保存 API Key"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
