import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, Globe, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Send, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation, LANGUAGES } from "@/lib/i18n";
import { ChangelogButton } from "@/components/help/ChangelogButton";

const TELEGRAM_GROUP_URL = "https://t.me/+ODpy7_7NlOE4NzA1";
interface Session { id: string; filePath: string; name?: string; firstMessage?: string; timestamp?: string; }
interface Group { projectPath: string; projectName: string; sessions: Session[]; }
interface SidebarProps { mobileOpen?: boolean; onClose?: () => void; }

function sessionTitle(session: Session) {
  if (session.name?.trim()) return session.name.trim();
  if (session.firstMessage?.trim()) return session.firstMessage.trim();
  const date = session.timestamp ? new Date(session.timestamp) : null;
  return date && !Number.isNaN(date.getTime()) ? `会话 · ${date.toLocaleDateString()}` : "新会话";
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const { t, lang, setLang } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [langOpen, setLangOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [menuMessage, setMenuMessage] = useState("");
  useEffect(() => {
    const load = () => fetch("/api/pi/sessions").then((r) => r.ok ? r.json() : []).then((nextGroups: Group[]) => setGroups(nextGroups)).catch(() => setGroups([]));
    load(); window.addEventListener("focus", load); window.addEventListener("pi-session-created", load);
    return () => { window.removeEventListener("focus", load); window.removeEventListener("pi-session-created", load); };
  }, []);
  const activeSession = useMemo(() => new URLSearchParams(location.search).get("session"), [location.search]);
  const moveToTrash = async (session: Session) => {
    if (!window.confirm(`将“${sessionTitle(session)}”移入回收站？可在会话管理中恢复。`)) return;
    try {
      const response = await fetch(`/api/pi/session?path=${encodeURIComponent(session.filePath)}`, { method: "DELETE" });
      const result = await response.json() as { success?: boolean };
      if (!result.success) throw new Error();
      setGroups((previous) => previous.map((group) => ({ ...group, sessions: group.sessions.filter((item) => item.id !== session.id) })).filter((group) => group.sessions.length > 0));
      setMenuSessionId(null);
      if (activeSession === session.id) navigate("/chat");
    } catch { setMenuMessage("移入回收站失败"); }
  };

  return <aside className={cn("codex-sidebar", mobileOpen && "is-open")}>
    <div className="codex-sidebar-top"><Link to="/chat" onClick={onClose} className="codex-brand" aria-label="Pi Chat home"><img src="/pi.svg" alt="" /><span>pi</span><small>local</small></Link><button className="sidebar-close" aria-label="Close navigation" onClick={onClose}><X className="h-4 w-4" /></button></div>
    <Link to="/chat" onClick={onClose} className="codex-new-chat"><MessageSquarePlus className="h-4 w-4" /><span>新建对话</span></Link>
    <div className="codex-history-label">项目对话</div>
    <nav className="codex-history" aria-label="Project conversations">{groups.map((group) => { const collapsed = collapsedGroups.has(group.projectPath); return <section key={group.projectPath} className="codex-project-group"><button className="codex-project-title" onClick={() => setCollapsedGroups((previous) => { const next = new Set(previous); if (next.has(group.projectPath)) next.delete(group.projectPath); else next.add(group.projectPath); return next; })}><ChevronRight className={cn("h-3.5 w-3.5", !collapsed && "rotate-90")} /><Folder className="h-3.5 w-3.5" /><span className="truncate">{group.projectName}</span><small>{group.sessions.length}</small></button>{!collapsed && group.sessions.map((session) => <div key={session.id} className={cn("codex-conversation-row", activeSession === session.id && "is-active")}><Link to={`/chat?session=${encodeURIComponent(session.id)}`} onClick={onClose} className="codex-conversation" title={sessionTitle(session)}><span className="truncate">{sessionTitle(session)}</span></Link><button className="conversation-more" aria-label={`会话菜单：${sessionTitle(session)}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setMenuSessionId((current) => current === session.id ? null : session.id); setMenuMessage(""); }}><MoreHorizontal className="h-4 w-4" /></button>{menuSessionId === session.id && <div className="conversation-menu"><button onClick={async () => { try { await navigator.clipboard.writeText(session.id); setMenuMessage("已复制"); } catch { setMenuMessage("复制失败"); } }}>复制会话 ID</button><Link to="/sessions" onClick={() => setMenuSessionId(null)}>打开会话管理</Link><button className="conversation-menu-danger" onClick={() => moveToTrash(session)}>移入回收站</button>{menuMessage && <small>{menuMessage}</small>}</div>}</div>)}</section>; })}{groups.length === 0 && <p className="codex-history-empty">尚无本地对话</p>}</nav>
    <div className="codex-sidebar-bottom"><Link to="/settings" onClick={onClose} className={cn("codex-settings-link", location.pathname.startsWith("/settings") && "is-active")}><Settings2 className="h-4 w-4" /><span>{t("nav.settings")}</span></Link><a href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer" className="codex-support-link"><Send className="h-3.5 w-3.5" /> 社区支持</a><div className="codex-language"><button onClick={() => setLangOpen((open) => !open)}><Globe className="h-3.5 w-3.5" /><span>{LANGUAGES.find((item) => item.code === lang)?.nativeLabel || "English"}</span><ChevronDown className={cn("ml-auto h-3.5 w-3.5", langOpen && "rotate-180")} /></button>{langOpen && <div className="language-menu">{LANGUAGES.map((item) => <button key={item.code} onClick={() => { setLang(item.code); setLangOpen(false); }} className={cn("language-option", lang === item.code && "is-selected")}>{item.nativeLabel}</button>)}</div>}</div><div className="codex-sidebar-version"><span>pi-switch</span><ChangelogButton /><PanelLeftClose className="h-3.5 w-3.5" /></div></div>
  </aside>;
}
