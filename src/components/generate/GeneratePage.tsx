import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Image as ImageIcon, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types";

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

// Documented tiers/ratios for the OpenAI-compatible images endpoint.
const IMAGE_SIZES = ["1K", "2K", "3K", "4K"] as const;
const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
// Videos: Flash tiers only accept 720P, so size is fixed and only ratio varies.
const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const VIDEO_SECONDS = ["4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
const VIDEO_MODES = [
  { value: "text", label: "文生视频" },
  { value: "keyframe", label: "首尾帧控制" },
  { value: "reference", label: "图片/音频参考" },
] as const;

// The status endpoint rate-limits below ~5s, so poll slower than the docs suggest.
const POLL_INTERVAL_MS = 8000;
const DONE_STATES = /^(completed|succeeded|success)$/i;
const FAILED_STATES = /^(failed|error|cancelled|canceled)$/i;

/** Resolve the key pi itself would use: active pool entry, then apiKey, then auth.json. */
function resolveProviderKey(provider: Provider | undefined, authKey: string | undefined): string {
  if (!provider) return "";
  const pool = provider.apiKeys ?? [];
  const active = pool.find((entry) => entry.id === provider.activeKeyId) ?? pool[0];
  return active?.key || provider.apiKey || authKey || "";
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

export function GeneratePage() {
  const { allProviders, auth } = useConfigStore();
  const [tab, setTab] = useState<"image" | "video">("image");

  // Any provider with an endpoint can serve these routes — the generation APIs
  // are separate from the chat api type stored on the provider.
  const usableProviders = useMemo(
    () => allProviders.filter((provider) => !!provider.baseUrl),
    [allProviders],
  );
  const [providerId, setProviderId] = useState("");
  useEffect(() => {
    if (usableProviders.some((provider) => provider.id === providerId)) return;
    setProviderId(usableProviders[0]?.id ?? "");
  }, [providerId, usableProviders]);
  const provider = usableProviders.find((entry) => entry.id === providerId);
  const apiKey = resolveProviderKey(provider, auth?.[providerId]?.key);

  const [imageModel, setImageModel] = useState("agnes-image-2.5-flash");
  const [videoModel, setVideoModel] = useState("agnes-video-2.5-flash");

  // ── Image state ──
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<string>("1K");
  const [imageRatio, setImageRatio] = useState<string>("1:1");
  const [imageFormat, setImageFormat] = useState<"url" | "b64_json">("url");
  const [imageRefs, setImageRefs] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageResult, setImageResult] = useState<GenerateResult | null>(null);

  // ── Video state ──
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoMode, setVideoMode] = useState<"text" | "keyframe" | "reference">("text");
  const [videoSeconds, setVideoSeconds] = useState<string>("5");
  const [videoRatio, setVideoRatio] = useState<string>("16:9");
  const [firstFrame, setFirstFrame] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [videoImages, setVideoImages] = useState("");
  const [videoAudios, setVideoAudios] = useState("");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<GenerateResult | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const runImage = async () => {
    if (!provider?.baseUrl || !imageModel.trim() || !imagePrompt.trim()) return;
    setImageBusy(true);
    setImageResult(null);
    try {
      const res = await fetch("/api/pi/image-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: provider.baseUrl,
          apiKey,
          model: imageModel.trim(),
          prompt: imagePrompt.trim(),
          size: imageSize,
          ratio: imageRatio,
          responseFormat: imageFormat,
          image: parseLines(imageRefs),
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
  const pollVideo = (videoId: string, model: string, baseUrl: string) => {
    const params = new URLSearchParams({ baseUrl, videoId, model, apiKey });
    pollTimer.current = window.setTimeout(async () => {
      let next: GenerateResult;
      try {
        const res = await fetch(`/api/pi/video-status?${params}`);
        next = (await res.json()) as GenerateResult;
      } catch {
        // Network blip — keep the task alive and try again.
        pollVideo(videoId, model, baseUrl);
        return;
      }
      // Rate limits and gateway errors are transient; keep the previous state.
      if (!next.success && next.retryable) {
        setVideoResult((prev) => ({ ...(prev ?? {}), ...next, success: true, message: undefined }));
        pollVideo(videoId, model, baseUrl);
        return;
      }
      setVideoResult(next);
      const finished =
        !!next.videoUrl || !next.success || FAILED_STATES.test(next.taskStatus ?? "") || DONE_STATES.test(next.taskStatus ?? "");
      if (finished) {
        setVideoBusy(false);
        stopPolling();
        return;
      }
      pollVideo(videoId, model, baseUrl);
    }, POLL_INTERVAL_MS);
  };

  const runVideo = async () => {
    if (!provider?.baseUrl || !videoModel.trim() || !videoPrompt.trim()) return;
    stopPolling();
    setVideoBusy(true);
    setVideoResult(null);
    const baseUrl = provider.baseUrl;
    const model = videoModel.trim();
    try {
      const res = await fetch("/api/pi/video-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          model,
          prompt: videoPrompt.trim(),
          mode: videoMode,
          seconds: videoSeconds,
          size: "720P",
          aspectRatio: videoRatio,
          firstFrame: videoMode === "keyframe" ? firstFrame.trim() : undefined,
          lastFrame: videoMode === "keyframe" ? lastFrame.trim() : undefined,
          images: videoMode === "reference" ? parseLines(videoImages) : undefined,
          audios: videoMode === "reference" ? parseLines(videoAudios) : undefined,
        }),
      });
      const created = (await res.json()) as GenerateResult;
      setVideoResult(created);
      if (created.success && created.videoId) {
        pollVideo(created.videoId, model, baseUrl);
      } else {
        setVideoBusy(false);
      }
    } catch {
      setVideoResult({ success: false, message: "请求失败，请检查开发服务器是否在运行" });
      setVideoBusy(false);
    }
  };

  const providerModelIds = provider?.models.map((model) => model.id) ?? [];

  return (
    <div className="skills-page" style={{ maxWidth: 960 }}>
      <header className="skills-page-heading">
        <div className="skills-page-mark">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="skills-page-kicker">GENERATION</p>
          <h1>生图 / 生视频</h1>
          <p>直接调用提供商的 OpenAI 兼容生成端点：图片走 /images/generations，视频走 /videos 异步任务。</p>
        </div>
      </header>

      {/* Provider + model are shared by both tabs. */}
      <div className="mb-4 grid gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 md:grid-cols-2">
        <Field label="提供商" hint={provider?.baseUrl}>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputCls}>
            {usableProviders.length === 0 && <option value="">没有可用提供商</option>}
            {usableProviders.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={tab === "image" ? "图片模型" : "视频模型"}
          hint={apiKey ? "已解析到 API Key" : "该提供商没有可用 Key，请求可能被拒绝"}
        >
          <input
            list="generate-model-options"
            value={tab === "image" ? imageModel : videoModel}
            onChange={(e) => (tab === "image" ? setImageModel(e.target.value) : setVideoModel(e.target.value))}
            placeholder={tab === "image" ? "agnes-image-2.5-flash" : "agnes-video-2.5-flash"}
            className={inputCls}
          />
          <datalist id="generate-model-options">
            {providerModelIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="mb-4 flex gap-2">
        {([
          { key: "image", icon: ImageIcon, label: "图片" },
          { key: "video", icon: Film, label: "视频" },
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
            <Field label="提示词">
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={3}
                placeholder="主体 + 场景 / 环境 + 风格 + 光照 + 构图 + 质量要求"
                className={cn(inputCls, "resize-y")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
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
            <Field label="参考图（可选，一行一个 URL 或 data URI）" hint="填写后为图生图；多张则为多图合成">
              <textarea
                value={imageRefs}
                onChange={(e) => setImageRefs(e.target.value)}
                rows={2}
                placeholder="https://example.com/input.png"
                className={cn(inputCls, "resize-y font-mono text-xs")}
              />
            </Field>
            <button
              onClick={runImage}
              disabled={imageBusy || !provider?.baseUrl || !imagePrompt.trim() || !imageModel.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {imageBusy ? "生成中…（可能需要数十秒）" : "生成图片"}
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
      ) : (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <Field label="提示词" hint="参考模式可用 <Picture 1> / <Audio 1> 指代素材">
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={3}
                placeholder="画面内容、镜头运动、光照氛围"
                className={cn(inputCls, "resize-y")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-4">
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
                <Field label="参考图片（一行一个，最多 5 张）">
                  <textarea
                    value={videoImages}
                    onChange={(e) => setVideoImages(e.target.value)}
                    rows={3}
                    className={cn(inputCls, "resize-y font-mono text-xs")}
                  />
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
              disabled={videoBusy || !provider?.baseUrl || !videoPrompt.trim() || !videoModel.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
              {videoBusy ? "生成中…（通常 2–4 分钟）" : "创建视频任务"}
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
      )}
    </div>
  );
}
