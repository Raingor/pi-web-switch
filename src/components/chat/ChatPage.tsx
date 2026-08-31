import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Folder, Loader2, MessageSquare, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message { role: "user" | "assistant"; text: string; kind?: "text" | "tool"; }
interface SessionHistory { messages: Message[]; total: number; }
interface ProjectGroup { projectPath: string; projectName: string; }

function InlineText({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function MessageText({ text }: { text: string }) {
  return <div className="codex-message-content">{text.split("\n").map((line, index) => <p key={index} className={line.startsWith("- ") ? "is-list" : ""}><InlineText text={line.startsWith("- ") ? line.slice(2) : line} /></p>)}</div>;
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? undefined;
  const preserveMessagesAfterCreate = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [activeRunSessionId, setActiveRunSessionId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [customProject, setCustomProject] = useState(false);
  const displayItems = useMemo(() => messages.reduce<({ type: "message"; message: Message } | { type: "tools"; count: number })[]>((items, message) => {
    if (message.kind === "tool" && message.role === "assistant") {
      const previous = items.at(-1);
      if (previous?.type === "tools") previous.count++;
      else items.push({ type: "tools", count: 1 });
    } else items.push({ type: "message", message });
    return items;
  }, []), [messages]);

  useEffect(() => {
    if (preserveMessagesAfterCreate.current) { preserveMessagesAfterCreate.current = false; return; }
    setMessages([]); setPrompt(""); setHistoryError("");
    if (!sessionId) return;
    const controller = new AbortController();
    setLoadingHistory(true);
    fetch(`/api/pi/session-history?id=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((history: SessionHistory) => setMessages(history.messages))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setHistoryError("加载会话历史失败"); })
      .finally(() => setLoadingHistory(false));
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return;
    fetch("/api/pi/sessions").then((res) => res.ok ? res.json() : []).then((groups: ProjectGroup[]) => setProjects(groups)).catch(() => setProjects([]));
  }, [sessionId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim(); if (!text || running || (customProject && !projectPath.trim())) return;
    const requestedSessionId = sessionId ?? `web-${crypto.randomUUID()}`;
    setActiveRunSessionId(requestedSessionId);
    setMessages((items) => [...items, { role: "user", text }, { role: "assistant", text: "" }]);
    setPrompt(""); setRunning(true);
    try {
      const res = await fetch("/api/pi/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, sessionId: requestedSessionId, projectPath: projectPath || undefined }) });
      if (!res.ok || !res.body) throw new Error("Request failed");
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let failure = "";
      const append = (chunk: string) => setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: item.text + chunk } : item));
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const raw of events) {
          const eventType = raw.match(/^event: (.+)$/m)?.[1]; const data = raw.match(/^data: (.+)$/m)?.[1]; if (!eventType || !data) continue;
          const payload = JSON.parse(data);
          if (eventType === "delta") append(payload);
          if (eventType === "done") { preserveMessagesAfterCreate.current = true; setSearchParams({ session: payload.sessionId }, { replace: true }); window.dispatchEvent(new Event("pi-session-created")); }
          if (eventType === "error") failure = payload;
        }
      }
      if (failure && failure !== "generation stopped") throw new Error(failure);
      if (failure === "generation stopped") setMessages((items) => items.map((item, index) => index === items.length - 1 && !item.text ? { ...item, text: "已停止生成。" } : item));
    } catch (error) {
      setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, text: `Error: ${error instanceof Error ? error.message : "Request failed"}` } : item));
    } finally { setRunning(false); setActiveRunSessionId(null); }
  };

  const stop = async () => {
    if (!activeRunSessionId) return;
    await fetch("/api/pi/chat/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: activeRunSessionId }) });
  };

  return <section className="codex-chat"><div className="codex-chat-title"><MessageSquare className="h-4 w-4" /><span>Pi</span><small>{sessionId ? "继续会话" : "本地工作区"}</small></div><div className="codex-messages">{loadingHistory && <div className="codex-history-loading"><Loader2 className="h-4 w-4 animate-spin" /> 正在加载会话历史…</div>}{historyError && <div className="codex-history-error">{historyError}</div>}{!loadingHistory && !historyError && messages.length === 0 && <div className="codex-empty"><div className="codex-empty-mark">π</div><h1>今天想做什么？</h1><p>选择项目目录后开始对话，新会话会归入该项目。</p><label className="codex-project-picker"><Folder className="h-4 w-4" /><span>项目目录</span><select value={customProject ? "__custom__" : projectPath} onChange={(event) => { const value = event.target.value; setCustomProject(value === "__custom__"); setProjectPath(value === "__custom__" ? "" : value); }}><option value="">当前项目（pi-web-switch）</option>{projects.map((project) => <option key={project.projectPath} value={project.projectPath}>{project.projectName}</option>)}<option value="__custom__">自定义目录…</option></select></label>{customProject && <input className="codex-custom-project" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="输入本地绝对路径，例如 /Users/name/project" autoFocus />}</div>}{displayItems.map((item, index) => item.type === "tools" ? <details key={index} className="codex-tool-group"><summary>已完成 {item.count} 个工作步骤</summary><p>工具调用内容已折叠，可按需展开查看。</p></details> : <div key={index} className={cn("codex-message", item.message.role === "user" && "is-user")}><div className="codex-message-avatar">{item.message.role === "user" ? "你" : "π"}</div><MessageText text={item.message.text} /></div>)}</div><form onSubmit={submit} className="codex-composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="询问任何问题" rows={1} /><button type="button" className="codex-stop" aria-label="停止生成" onClick={stop} disabled={!running}><Square className="h-3 w-3 fill-current" /></button><button aria-label="Send message" disabled={running || !prompt.trim() || (customProject && !projectPath.trim())}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></form><p className="codex-disclaimer">Pi 可能会出错，请核查重要信息。</p></section>;
}
