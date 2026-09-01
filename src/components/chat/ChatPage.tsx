import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useConfigStore } from "@/store/config-store";

interface Message {
  id?: string;
  role: "user" | "assistant";
  text: string;
  kind?: "text" | "tool";
}
interface SessionHistory {
  messages: Message[];
  total: number;
}
interface ProjectGroup {
  projectPath: string;
  projectName: string;
}

const THINKING_OPTIONS = [
  ["", "Default"],
  ["off", "Off"],
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Maximum"],
] as const;
type ThinkingLevel = Exclude<(typeof THINKING_OPTIONS)[number][0], "">;
const STANDARD_THINKING_OPTIONS = THINKING_OPTIONS.filter(([level]) =>
  ["low", "medium", "high", "max"].includes(level),
);

function MessageText({ text }: { text: string }) {
  return (
    <div className="codex-message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ChatPage() {
  const { allModels, allProviders, settings } = useConfigStore();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? undefined;
  const preserveMessagesAfterCreate = useRef(false);
  const scrollToLatestAfterHistory = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [activeRunSessionId, setActiveRunSessionId] = useState<string | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [customProject, setCustomProject] = useState(false);
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => window.localStorage.getItem("pi-web-switch:chat-model") ?? "",
  );
  const [selectedThinking, setSelectedThinking] = useState(
    () => window.localStorage.getItem("pi-web-switch:chat-thinking") ?? "",
  );
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [activeModelProviderId, setActiveModelProviderId] = useState<
    string | null
  >(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const [editError, setEditError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const defaultModelRef =
    settings?.defaultProvider && settings.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : "";
  const customProviderIds = useMemo(
    () =>
      new Set(
        allProviders
          .filter((provider) => provider.type === "custom")
          .map((provider) => provider.id),
      ),
    [allProviders],
  );
  const codexProviderAvailable = allProviders.some(
    (provider) => provider.id === "openai-codex" && provider.hasAuth,
  );
  const selectableModels = useMemo(() => {
    const enabled = new Set(settings?.enabledModels ?? []);
    return allModels.filter(
      (model) =>
        enabled.has(`${model.providerId}/${model.id}`) ||
        `${model.providerId}/${model.id}` === defaultModelRef ||
        customProviderIds.has(model.providerId) ||
        (codexProviderAvailable && model.providerId === "openai-codex"),
    );
  }, [
    allModels,
    codexProviderAvailable,
    customProviderIds,
    defaultModelRef,
    settings?.enabledModels,
  ]);
  const modelGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; models: typeof selectableModels }
    >();
    selectableModels.forEach((model) => {
      const group = groups.get(model.providerId) ?? {
        id: model.providerId,
        name: model.providerName,
        models: [],
      };
      group.models.push(model);
      groups.set(model.providerId, group);
    });
    return [...groups.values()];
  }, [selectableModels]);
  const selectedModelInfo = selectableModels.find(
    (model) => `${model.providerId}/${model.id}` === selectedModel,
  );
  const effectiveModelInfo =
    selectedModelInfo ??
    allModels.find(
      (model) => `${model.providerId}/${model.id}` === defaultModelRef,
    );
  const supportedThinkingOptions = useMemo(() => {
    if (effectiveModelInfo?.providerId !== "openai-codex") {
      return STANDARD_THINKING_OPTIONS;
    }

    return THINKING_OPTIONS.filter(([level]) => {
      if (level === "") return true;
      if (!effectiveModelInfo?.reasoning) return level === "off";

      const mappedLevel =
        effectiveModelInfo.thinkingLevelMap?.[level as ThinkingLevel];
      if (mappedLevel === null) return false;
      return (
        (level !== "xhigh" && level !== "max") || mappedLevel !== undefined
      );
    });
  }, [effectiveModelInfo]);
  const activeModelGroup =
    modelGroups.find((group) => group.id === activeModelProviderId) ??
    modelGroups[0];
  const displayItems = useMemo(
    () =>
      messages.reduce<
        (
          | { type: "message"; message: Message }
          | { type: "tools"; count: number }
        )[]
      >((items, message) => {
        if (message.kind === "tool" && message.role === "assistant") {
          const previous = items.at(-1);
          if (previous?.type === "tools") previous.count++;
          else items.push({ type: "tools", count: 1 });
        } else items.push({ type: "message", message });
        return items;
      }, []),
    [messages],
  );
  const updateScrollToBottomVisibility = () => {
    const container = messagesRef.current;
    if (!container) return;
    setShowScrollToBottom(
      container.scrollHeight - container.scrollTop - container.clientHeight >
        80,
    );
  };
  const scrollToBottom = () => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollToBottom(false);
  };

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;

    const maxHeight = 160;
    textarea.style.height = "auto";
    const height = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt]);

  useLayoutEffect(() => {
    if (scrollToLatestAfterHistory.current && !loadingHistory) {
      const container = messagesRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      scrollToLatestAfterHistory.current = false;
      setShowScrollToBottom(false);
      return;
    }
    updateScrollToBottomVisibility();
  }, [loadingHistory, messages]);

  useEffect(() => {
    if (
      selectedModel &&
      selectableModels.some(
        (model) => `${model.providerId}/${model.id}` === selectedModel,
      )
    )
      return;
    const fallback =
      defaultModelRef ||
      (selectableModels[0]
        ? `${selectableModels[0].providerId}/${selectableModels[0].id}`
        : "");
    setSelectedModel(fallback);
  }, [defaultModelRef, selectableModels, selectedModel]);

  useEffect(() => {
    if (supportedThinkingOptions.some(([value]) => value === selectedThinking))
      return;
    const fallback = supportedThinkingOptions[0]?.[0] ?? "";
    setSelectedThinking(fallback);
    window.localStorage.setItem("pi-web-switch:chat-thinking", fallback);
  }, [selectedThinking, supportedThinkingOptions]);

  useEffect(() => {
    if (
      activeModelProviderId &&
      modelGroups.some((group) => group.id === activeModelProviderId)
    )
      return;
    const selectedProviderId = selectedModel.split("/")[0];
    setActiveModelProviderId(
      modelGroups.find((group) => group.id === selectedProviderId)?.id ??
        modelGroups[0]?.id ??
        null,
    );
  }, [activeModelProviderId, modelGroups, selectedModel]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node))
        setModelMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (preserveMessagesAfterCreate.current) {
      preserveMessagesAfterCreate.current = false;
      return;
    }
    setMessages([]);
    setPrompt("");
    setHistoryError("");
    if (!sessionId) {
      scrollToLatestAfterHistory.current = false;
      return;
    }
    const controller = new AbortController();
    scrollToLatestAfterHistory.current = true;
    setLoadingHistory(true);
    fetch(`/api/pi/session-history?id=${encodeURIComponent(sessionId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((history: SessionHistory) => setMessages(history.messages))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setHistoryError("加载会话历史失败");
      })
      .finally(() => setLoadingHistory(false));
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) return;
    fetch("/api/pi/sessions")
      .then((res) => (res.ok ? res.json() : []))
      .then((groups: ProjectGroup[]) => setProjects(groups))
      .catch(() => setProjects([]));
  }, [sessionId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || running || (customProject && !projectPath.trim())) return;
    const requestedSessionId = sessionId ?? `web-${crypto.randomUUID()}`;
    setActiveRunSessionId(requestedSessionId);
    setMessages((items) => [
      ...items,
      { id: `local-${crypto.randomUUID()}`, role: "user", text },
      { role: "assistant", text: "" },
    ]);
    setPrompt("");
    setRunning(true);
    try {
      const res = await fetch("/api/pi/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          sessionId: requestedSessionId,
          projectPath: projectPath || undefined,
          model: selectedModel || undefined,
          thinking: selectedThinking || undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure = "";
      const append = (chunk: string) =>
        setMessages((items) =>
          items.map((item, index) =>
            index === items.length - 1
              ? { ...item, text: item.text + chunk }
              : item,
          ),
        );
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const eventType = raw.match(/^event: (.+)$/m)?.[1];
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (!eventType || !data) continue;
          const payload = JSON.parse(data);
          if (eventType === "delta") append(payload);
          if (eventType === "done") {
            preserveMessagesAfterCreate.current = true;
            setSearchParams({ session: payload.sessionId }, { replace: true });
            window.dispatchEvent(new Event("pi-session-created"));
          }
          if (eventType === "error") failure = payload;
        }
      }
      if (failure && failure !== "generation stopped") throw new Error(failure);
      if (failure === "generation stopped")
        setMessages((items) =>
          items.map((item, index) =>
            index === items.length - 1 && !item.text
              ? { ...item, text: "已停止生成。" }
              : item,
          ),
        );
    } catch (error) {
      setMessages((items) =>
        items.map((item, index) =>
          index === items.length - 1
            ? {
                ...item,
                text: `Error: ${error instanceof Error ? error.message : "Request failed"}`,
              }
            : item,
        ),
      );
    } finally {
      setRunning(false);
      setActiveRunSessionId(null);
    }
  };

  const stop = async () => {
    if (!activeRunSessionId) return;
    await fetch("/api/pi/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeRunSessionId }),
    });
  };
  const copyMessage = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopiedMessageId(messageId);
    window.setTimeout(
      () => setCopiedMessageId((current) => current === messageId ? null : current),
      1500,
    );
  };
  const startEditingMessage = (message: Message) => {
    if (!message.id) return;
    setEditingMessageId(message.id);
    setEditingText(message.text);
    setEditError("");
  };
  const saveEditedMessage = async (message: Message) => {
    const nextText = editingText.trim();
    if (!message.id || !nextText || savingMessage) return;
    setSavingMessage(true);
    try {
      if (sessionId && !message.id.startsWith("local-")) {
        const response = await fetch("/api/pi/session-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, messageId: message.id, text: nextText }),
        });
        const result = (await response.json()) as { success?: boolean };
        if (!response.ok || !result.success) throw new Error("save failed");
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === message.id ? { ...item, text: nextText } : item,
        ),
      );
      setEditingMessageId(null);
    } catch {
      setEditError(t("chat.save_failed"));
    } finally {
      setSavingMessage(false);
    }
  };
  const chooseDirectory = async () => {
    setChoosingDirectory(true);
    try {
      const response = await fetch("/api/pi/chat/select-directory", {
        method: "POST",
      });
      const result = (await response.json()) as { path?: string | null };
      if (result.path) setProjectPath(result.path);
    } finally {
      setChoosingDirectory(false);
    }
  };
  const chooseModel = (model: string) => {
    setSelectedModel(model);
    window.localStorage.setItem("pi-web-switch:chat-model", model);
    setModelMenuOpen(false);
  };

  return (
    <section className="codex-chat">
      <div className="codex-chat-title">
        <MessageSquare className="h-4 w-4" />
        <span>Pi</span>
        <small>{sessionId ? "继续会话" : "本地工作区"}</small>
      </div>
      <div className="codex-message-pane">
        <div
          ref={messagesRef}
          onScroll={updateScrollToBottomVisibility}
          className="codex-messages"
        >
          {loadingHistory && (
            <div className="codex-history-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在加载会话历史…
            </div>
          )}
          {historyError && (
            <div className="codex-history-error">{historyError}</div>
          )}
          {!loadingHistory && !historyError && messages.length === 0 && (
            <div className="codex-empty">
              <div className="codex-empty-mark">π</div>
              <h1>今天想做什么？</h1>
              <p>选择项目目录后开始对话，新会话会归入该项目。</p>
              <label className="codex-project-picker">
                <Folder className="h-4 w-4" />
                <span>项目目录</span>
                <select
                  value={customProject ? "__custom__" : projectPath}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustomProject(value === "__custom__");
                    setProjectPath(value === "__custom__" ? "" : value);
                  }}
                >
                  <option value="">当前项目（pi-web-switch）</option>
                  {projects.map((project) => (
                    <option
                      key={project.projectPath}
                      value={project.projectPath}
                    >
                      {project.projectName}
                    </option>
                  ))}
                  <option value="__custom__">自定义目录…</option>
                </select>
              </label>
              {customProject && (
                <div className="codex-custom-directory">
                  <input
                    className="codex-custom-project"
                    value={projectPath}
                    onChange={(event) => setProjectPath(event.target.value)}
                    placeholder="选择或输入本地绝对路径"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={chooseDirectory}
                    disabled={choosingDirectory}
                  >
                    {choosingDirectory ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="h-4 w-4" />
                    )}
                    选择目录…
                  </button>
                </div>
              )}
            </div>
          )}
          {displayItems.map((item, index) =>
            item.type === "tools" ? (
              <details key={index} className="codex-tool-group">
                <summary>已完成 {item.count} 个工作步骤</summary>
                <p>工具调用内容已折叠，可按需展开查看。</p>
              </details>
            ) : (
              <div
                key={index}
                className={cn(
                  "codex-message",
                  item.message.role === "user" && "is-user",
                )}
              >
                <div className="codex-message-avatar">
                  {item.message.role === "user" ? "你" : "π"}
                </div>
                {item.message.role === "user" &&
                item.message.id &&
                editingMessageId === item.message.id ? (
                  <div className="codex-message-editor">
                    <textarea
                      value={editingText}
                      autoFocus
                      rows={Math.min(
                        10,
                        Math.max(2, editingText.split("\n").length),
                      )}
                      onChange={(event) => setEditingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingMessageId(null);
                        }
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          void saveEditedMessage(item.message);
                        }
                      }}
                    />
                    {editError && (
                      <p className="codex-message-edit-error">{editError}</p>
                    )}
                    <div className="codex-message-edit-actions">
                      <button
                        type="button"
                        onClick={() => setEditingMessageId(null)}
                        disabled={savingMessage}
                      >
                        {t("chat.cancel")}
                      </button>
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => void saveEditedMessage(item.message)}
                        disabled={savingMessage || !editingText.trim()}
                      >
                        {savingMessage ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {t("chat.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="codex-message-body">
                    <MessageText text={item.message.text} />
                    {item.message.role === "user" && item.message.id && (
                      <div className="codex-message-actions">
                        <button
                          type="button"
                          title={t("chat.copy")}
                          aria-label={t("chat.copy")}
                          onClick={() =>
                            void copyMessage(
                              item.message.id!,
                              item.message.text,
                            )
                          }
                        >
                          {copiedMessageId === item.message.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          title={t("chat.edit")}
                          aria-label={t("chat.edit")}
                          disabled={running}
                          onClick={() => startEditingMessage(item.message)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            className="codex-scroll-bottom"
            onClick={scrollToBottom}
            aria-label="滚动到最新消息"
            title="回到底部"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>
      <form onSubmit={submit} className="codex-composer">
        <div ref={modelPickerRef} className="codex-model-picker">
          <button
            type="button"
            className="codex-model-trigger"
            disabled={running || selectableModels.length === 0}
            onClick={() => {
              setActiveModelProviderId(
                selectedModelInfo?.providerId ?? modelGroups[0]?.id ?? null,
              );
              setModelMenuOpen((open) => !open);
            }}
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="truncate">
              {selectedModelInfo
                ? `${selectedModelInfo.providerName} / ${selectedModelInfo.name || selectedModelInfo.id}`
                : "Pi 默认模型"}
            </span>
            <ChevronDown
              className={cn("h-3.5 w-3.5", modelMenuOpen && "rotate-180")}
            />
          </button>
          {modelMenuOpen && (
            <div className="codex-model-menu">
              <div className="codex-provider-list">
                <button
                  type="button"
                  className={cn(
                    "codex-provider-option",
                    !selectedModel && "is-selected",
                  )}
                  onClick={() => chooseModel("")}
                >
                  <span>Pi 默认模型</span>
                  {!selectedModel && <Check className="h-3.5 w-3.5" />}
                </button>
                {modelGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={cn(
                      "codex-provider-option",
                      activeModelGroup?.id === group.id && "is-active",
                    )}
                    onMouseEnter={() => setActiveModelProviderId(group.id)}
                    onClick={() => setActiveModelProviderId(group.id)}
                  >
                    <span className="truncate">{group.name}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <div className="codex-provider-models">
                {activeModelGroup && (
                  <>
                    <p>{activeModelGroup.name}</p>
                    {activeModelGroup.models.map((model) => {
                      const value = `${model.providerId}/${model.id}`;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cn(
                            "codex-provider-model",
                            selectedModel === value && "is-selected",
                          )}
                          onClick={() => chooseModel(value)}
                        >
                          <span className="truncate">
                            {model.name || model.id}
                          </span>
                          {selectedModel === value && (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
                <Link to="/providers" onClick={() => setModelMenuOpen(false)}>
                  管理模型
                </Link>
              </div>
            </div>
          )}
        </div>
        <label className="codex-thinking-picker" title="选择本次对话的思考深度">
          <BrainCircuit className="h-3.5 w-3.5" />
          <select
            value={selectedThinking}
            disabled={running}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedThinking(value);
              window.localStorage.setItem("pi-web-switch:chat-thinking", value);
            }}
          >
            {supportedThinkingOptions.map(([value, label]) => (
              <option key={value || "default"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a newline. IME composition
            // (e.g. Chinese input) must not be interrupted by a send.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit(event);
            }
          }}
          placeholder={t("chat.input_placeholder")}
          rows={1}
        />
        <button
          type="button"
          className="codex-stop"
          aria-label="停止生成"
          onClick={stop}
          disabled={!running}
        >
          <Square className="h-3 w-3 fill-current" />
        </button>
        <button
          aria-label="Send message"
          disabled={
            running || !prompt.trim() || (customProject && !projectPath.trim())
          }
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
      <p className="codex-disclaimer">Pi 可能会出错，请核查重要信息。</p>
    </section>
  );
}
