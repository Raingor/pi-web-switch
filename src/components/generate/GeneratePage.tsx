import { useEffect, useState } from "react";
import { BookOpen, Check, ExternalLink, Eye, EyeOff, Image as ImageIcon, KeyRound, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const AGNES_MODEL = "agnes-3.0-flash";
const AGNES_DOCS = "https://agnes-ai.com/zh-Hans/docs/agnes-30-flash.md";

interface AgnesConfigView {
  baseUrl: string;
  hasKey: boolean;
  maskedKey: string;
}

interface ChatResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  message?: string;
  reply?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

type MessageContent = string | Array<
  { type: "text"; text: string } |
  { type: "image_url"; image_url: { url: string } }
>;
type ChatMessage = { role: "system" | "user" | "assistant"; content: MessageContent; imageUrl?: string };

type ApiMessage = { role: ChatMessage["role"]; content: MessageContent };

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

function messageText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function GeneratePage() {
  const [config, setConfig] = useState<AgnesConfigView | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyError, setKeyError] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [temperature, setTemperature] = useState("0.7");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastMeta, setLastMeta] = useState<{ latencyMs?: number; totalTokens?: number } | null>(null);

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

  const sendMessage = async () => {
    const text = prompt.trim();
    if (!config?.hasKey || !text || busy) return;
    setBusy(true);
    setError("");

    const content: MessageContent = imageUrl.trim()
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: imageUrl.trim() } },
        ]
      : text;
    const userMessage: ChatMessage = { role: "user", content, imageUrl: imageUrl.trim() || undefined };
    const history: ApiMessage[] = [
      ...(systemPrompt.trim() ? [{ role: "system" as const, content: systemPrompt.trim() }] : []),
      ...messages.map(({ role, content: value }) => ({ role, content: value })),
      { role: "user" as const, content },
    ];
    setMessages((previous) => [...previous, userMessage]);
    setPrompt("");
    setImageUrl("");

    try {
      const res = await fetch("/api/pi/agnes-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: AGNES_MODEL,
          messages: history,
          maxTokens: Number(maxTokens) || 1024,
          temperature: Number(temperature),
        }),
      });
      const result = (await res.json()) as ChatResult;
      if (!result.success || !result.reply) {
        setError(`${result.status ? `HTTP ${result.status}：` : ""}${result.message || "请求失败"}`);
        setMessages((previous) => previous.slice(0, -1));
        return;
      }
      setMessages((previous) => [...previous, { role: "assistant", content: result.reply! }]);
      setLastMeta({ latencyMs: result.latencyMs, totalTokens: result.usage?.totalTokens });
    } catch {
      setError("请求失败，请检查开发服务器或网络连接");
      setMessages((previous) => previous.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  const clearConversation = () => {
    if (busy) return;
    setMessages([]);
    setError("");
    setLastMeta(null);
  };

  const ready = !!config?.hasKey;

  return (
    <div className="skills-page" style={{ maxWidth: 960 }}>
      <header className="skills-page-heading">
        <div className="skills-page-mark">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <p className="skills-page-kicker">AGNES 3.0 FLASH</p>
          <h1>Agnes 3.0 Flash</h1>
          <p>新一代文本模型，支持 Agent 任务、工具编排和图像 URL 输入。与提供商与模型页面的聊天配置互不影响。</p>
        </div>
      </header>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-800 bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-300">{AGNES_MODEL}</span>
            <span className="text-xs text-gray-500">512K 上下文 · 65,536 最大输出 · 文本 / 图像 URL → 文本</span>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">端点：{config?.baseUrl || "https://apihub.agnes-ai.com/v1"}/chat/completions</p>
        </div>
        <a
          href={AGNES_DOCS}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
        >
          <BookOpen className="h-4 w-4" />
          查看 3.0 文档
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-gray-200">Agnes API Key</h2>
          {config?.hasKey ? (
            <span className="rounded-full border border-emerald-800 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">{config.maskedKey}</span>
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
            <button type="button" onClick={() => setShowKey((previous) => !previous)} title={showKey ? "隐藏" : "显示"} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button onClick={saveKey} disabled={savingKey || !keyDraft.trim()} className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">
            {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : keySaved ? <Check className="h-4 w-4 text-emerald-400" /> : null}
            {keySaved ? "已保存" : "保存"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">保存到 ~/.pi/agent/agnes-config.json（权限 0600），仅服务端读取，不会回传浏览器。</p>
        {keyError && <p className="mt-1 text-xs text-red-400">{keyError}</p>}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-gray-200">对话控制台</h2>
          </div>
          <button onClick={clearConversation} disabled={busy || messages.length === 0} className="flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" /> 清空对话
          </button>
        </div>

        <div className="mb-4 min-h-[180px] space-y-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          {messages.length === 0 ? (
            <div className="flex min-h-[154px] flex-col items-center justify-center gap-2 text-center text-gray-600">
              <MessageSquare className="h-7 w-7" />
              <p className="text-sm">输入任务，开始与 Agnes 3.0 Flash 对话</p>
              <p className="text-[11px]">支持多轮上下文和图像 URL 输入</p>
            </div>
          ) : messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={cn("rounded-lg border px-3 py-2.5", message.role === "user" ? "ml-6 border-blue-900/60 bg-blue-950/20" : "mr-6 border-gray-800 bg-gray-900/70")}>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">{message.role === "user" ? "YOU" : "AGNES 3.0"}</div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{messageText(message.content)}</p>
              {message.imageUrl && <p className="mt-1 truncate font-mono text-[10px] text-blue-400/70">图片：{message.imageUrl}</p>}
            </div>
          ))}
          {busy && <div className="mr-6 flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2.5 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Agnes 正在思考…</div>}
        </div>

        <div className="space-y-3">
          <Field label="提示词">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendMessage(); }} rows={4} placeholder="描述任务、问题或需要 Agnes 执行的步骤……（⌘/Ctrl + Enter 发送）" className={cn(inputCls, "resize-y")} />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="系统提示词（可选）"><input value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="定义助手角色和回答风格" className={inputCls} /></Field>
            <Field label="图像 URL（可选）" hint="支持公开可访问的图片 URL"><input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://example.com/image.png" className={cn(inputCls, "font-mono text-xs")} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="最大输出"><input type="number" min="1" max="65536" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className={inputCls} /></Field>
              <Field label="温度"><input type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} className={inputCls} /></Field>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {lastMeta ? <span className="text-[11px] text-gray-600">本轮完成 · {lastMeta.latencyMs ?? 0}ms{lastMeta.totalTokens ? ` · ${lastMeta.totalTokens.toLocaleString()} tokens` : ""}</span> : <span />}
            <button onClick={() => void sendMessage()} disabled={busy || !ready || !prompt.trim()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? "生成中…" : ready ? "发送给 Agnes 3.0" : "请先保存 API Key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
