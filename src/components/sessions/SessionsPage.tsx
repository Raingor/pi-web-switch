import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import {
  History, MessageSquare, Clock, ChevronDown, ChevronRight, Trash2, AlertTriangle,
  Shield, RefreshCw, Undo2, Eye,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";

function isRecent(isoDate: string): boolean {
  if (!isoDate) return false;
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  return now - then < threeDaysMs;
}

interface SessionInfo {
  id: string;
  fileName: string;
  filePath: string;
  timestamp: string;
  lastActive: string;
  name?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  duration?: number;
}

interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: SessionInfo[];
  totalSessions: number;
  lastActive: string;
}

interface TrashEntry {
  trashPath: string;
  originalPath: string;
  fileName: string;
  trashedAt: string;
  sessionId: string;
  sessionName: string;
  lastActive: string;
  messageCount: number;
}

interface PreviewMessage {
  role: string;
  text: string;
  timestamp: string;
}

const SESSIONS_PER_GROUP = 50;

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Relative date: today / yesterday / Nd ago / short date */
function formatRelativeDate(iso: string, t: (key: string, ...args: string[]) => string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return t("common.today");
  if (days === 1) return t("common.yesterday");
  if (days < 7) return t("common.days_ago", String(days));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sessionDisplayName(s: { name?: string; fileName: string; id?: string }): string {
  return s.name || s.fileName.replace(/\.jsonl$/, "").split("_").pop() || s.id?.slice(0, 12) || s.fileName;
}

/** Full timestamp for tooltips — accepts ISO strings, guards invalid dates */
function formatFullTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function ProjectCard({
  group,
  defaultOpen,
  forceOpen,
  onDelete,
  onPreview,
}: {
  group: ProjectGroup;
  defaultOpen: boolean;
  forceOpen: boolean;
  onDelete: (session: SessionInfo, groupPath: string) => void;
  onPreview: (session: SessionInfo) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen || open;
  const visibleSessions = group.sessions.slice(0, SESSIONS_PER_GROUP);
  const hiddenCount = group.sessions.length - visibleSessions.length;

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--card-border)" }}>
      {/* Project Header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4"
        style={{ backgroundColor: "var(--card-bg)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--accent-bg)" }}>
            <History className="h-4 w-4" style={{ color: "var(--sidebar-active-text)" }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{group.projectName}</h3>
            <p className="text-xs" style={{ color: "var(--muted-text)" }}>
              {t("sessions.sessions_count", String(group.totalSessions))} · {t("sessions.last_active", formatRelativeDate(group.lastActive, t))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: "var(--sidebar-active-text)" }}>
            {group.totalSessions}
          </span>
          {isOpen ? <ChevronDown className="h-4 w-4" style={{ color: "var(--muted-text)" }} /> : <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-text)" }} />}
        </div>
      </button>

      {/* Session List */}
      {isOpen && (
        <div style={{ borderTop: "1px solid var(--card-border)" }}>
          {visibleSessions.map((session) => (
            <div
              key={session.id || session.fileName}
              className="group flex items-center justify-between px-6 py-3 cursor-pointer transition-colors hover:bg-gray-500/5"
              style={{
                borderBottom: "1px solid var(--card-border)",
                backgroundColor: "var(--page-bg)",
              }}
              onClick={() => onPreview(session)}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex flex-col items-center justify-center w-8 h-8 rounded-md" style={{ backgroundColor: "var(--accent-bg)" }}>
                  <MessageSquare className="h-3.5 w-3.5" style={{ color: "var(--sidebar-active-text)" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--page-text)" }}>
                    {sessionDisplayName(session)}
                  </p>
                  <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted-text)" }}>
                    <span title={formatFullTimestamp(session.timestamp)}>{formatRelativeDate(session.timestamp, t)}</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {session.messageCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(session.duration)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                {session.provider && session.provider !== "unknown" && (
                  <span className="text-xs rounded-md px-2 py-0.5" style={{ backgroundColor: "var(--accent-bg)", color: "var(--sidebar-active-text)" }}>
                    {session.provider}/{session.model?.split("-").slice(0, 2).join("-") || session.model}
                  </span>
                )}
                <span
                  className="rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--subtle-text)" }}
                  title={t("sessions.preview_title")}
                >
                  <Eye className="h-3.5 w-3.5" />
                </span>
                {isRecent(session.lastActive) ? (
                  <span
                    className="rounded-lg p-1.5"
                    style={{ color: "var(--subtle-text)" }}
                    title={t("sessions.protected")}
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(session, group.projectPath);
                    }}
                    className="rounded-lg p-1.5 transition-opacity"
                    style={{ color: "var(--subtle-text)" }}
                    title={t("sessions.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <p className="px-6 py-2.5 text-xs" style={{ color: "var(--subtle-text)" }}>
              {t("sessions.more_count", String(hiddenCount))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionsPage() {
  const { t } = useTranslation();
  const { initialized } = useConfigStore();
  const [tab, setTab] = useState<"sessions" | "trash">("sessions");
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ session: SessionInfo; groupPath: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Trash tab state
  const [selectedTrash, setSelectedTrash] = useState<Set<string>>(new Set());
  const [purgeTarget, setPurgeTarget] = useState<"batch" | TrashEntry | null>(null);
  const [purging, setPurging] = useState(false);
  // Preview modal state
  const [previewTarget, setPreviewTarget] = useState<SessionInfo | null>(null);
  const [preview, setPreview] = useState<{ messages: PreviewMessage[]; total: number } | null>(null);
  const [previewError, setPreviewError] = useState(false);

  const loadAll = useCallback(() => {
    if (!initialized) return;
    setRefreshing(true);
    Promise.all([
      fetch("/api/pi/sessions").then((r) => r.json()),
      fetch("/api/pi/trash").then((r) => r.json()),
    ])
      .then(([sessionData, trashData]) => {
        setGroups(sessionData);
        setTrash(trashData);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [initialized]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Move session to trash (recoverable)
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/pi/session?path=${encodeURIComponent(deleteTarget.session.filePath)}`,
        { method: "DELETE" }
      );
      const result = await res.json();
      if (result.success) {
        setDeleteTarget(null);
        loadAll();
      } else {
        alert(t("sessions.delete_failed"));
      }
    } catch {
      alert(t("sessions.delete_error"));
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = async (trashPath: string) => {
    try {
      await fetch("/api/pi/session/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashPath }),
      });
    } catch { /* reload below reflects the actual state */ }
    setSelectedTrash((prev) => { const next = new Set(prev); next.delete(trashPath); return next; });
    loadAll();
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    const paths = purgeTarget === "batch" ? [...selectedTrash] : [purgeTarget.trashPath];
    for (const p of paths) {
      try {
        await fetch(`/api/pi/trash?path=${encodeURIComponent(p)}`, { method: "DELETE" });
      } catch { /* continue */ }
    }
    setPurging(false);
    setPurgeTarget(null);
    setSelectedTrash(new Set());
    loadAll();
  };

  const handleBatchRestore = async () => {
    for (const p of selectedTrash) {
      try {
        await fetch("/api/pi/session/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashPath: p }),
        });
      } catch { /* continue */ }
    }
    setSelectedTrash(new Set());
    loadAll();
  };

  const openPreview = (session: SessionInfo) => {
    setPreviewTarget(session);
    setPreview(null);
    setPreviewError(false);
    fetch(`/api/pi/session-preview?path=${encodeURIComponent(session.filePath)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setPreview)
      .catch(() => setPreviewError(true));
  };

  // Search matches project names AND session names; matched projects auto-expand
  const q = filter.trim().toLowerCase();
  const filteredGroups = !q
    ? groups
    : groups
        .map((g) => {
          if (g.projectName.toLowerCase().includes(q)) return g;
          const sessions = g.sessions.filter((s) =>
            sessionDisplayName(s).toLowerCase().includes(q)
          );
          return sessions.length > 0
            ? { ...g, sessions, totalSessions: sessions.length }
            : null;
        })
        .filter((g): g is ProjectGroup => g !== null);

  const toggleTrashSelect = (path: string) => {
    setSelectedTrash((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const allTrashSelected = trash.length > 0 && trash.every((e) => selectedTrash.has(e.trashPath));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: "var(--error-text, #ef4444)" }}>{t("sessions.load_failed")}: {error}</p>
      </div>
    );
  }

  const totalSessions = groups.reduce((s, g) => s + g.totalSessions, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>{t("sessions.title")}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("sessions.summary", String(totalSessions), String(groups.length))}
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
          title={t("sessions.refresh")}
        >
          <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {t("sessions.refresh")}
        </button>
      </div>

      {/* Tabs: Sessions / Trash */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--card-border)" }}>
        {([
          { key: "sessions" as const, label: t("sessions.tab_sessions"), count: totalSessions },
          { key: "trash" as const, label: t("sessions.tab_trash"), count: trash.length },
        ]).map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{
              color: tab === item.key ? "#3b82f6" : "var(--muted-text)",
              borderBottomColor: tab === item.key ? "#3b82f6" : "transparent",
            }}
          >
            {item.key === "trash" && <Trash2 className="h-3.5 w-3.5" />}
            {item.label}
            {item.count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  backgroundColor: item.key === "trash" && item.count > 0 ? "rgba(239,68,68,0.15)" : "var(--accent-bg)",
                  color: item.key === "trash" && item.count > 0 ? "#ef4444" : "var(--sidebar-active-text)",
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "sessions" && (
        <>
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("sessions.filter_placeholder")}
              className="w-full rounded-lg border px-4 py-2.5 pl-10 text-sm"
              style={{
                backgroundColor: "var(--input-bg)",
                borderColor: "var(--input-border)",
                color: "var(--input-text)",
              }}
            />
            <History className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--muted-text)" }} />
          </div>

          {/* Project Groups */}
          <div className="space-y-3">
            {filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <History className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
                <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("sessions.no_sessions")}</p>
              </div>
            ) : (
              filteredGroups.map((group, i) => (
                <ProjectCard
                  key={group.projectPath}
                  group={group}
                  defaultOpen={i < 3}
                  forceOpen={!!q}
                  onDelete={(session, groupPath) => setDeleteTarget({ session, groupPath })}
                  onPreview={openPreview}
                />
              ))
            )}
          </div>
        </>
      )}

      {tab === "trash" && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--muted-text)" }}>{t("sessions.trash_desc")}</p>

          {/* Batch action bar */}
          {trash.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--muted-text)" }}>
                <input
                  type="checkbox"
                  checked={allTrashSelected}
                  onChange={() => setSelectedTrash(allTrashSelected ? new Set() : new Set(trash.map((e) => e.trashPath)))}
                />
                {t("sessions.select_all")}
              </label>
              {selectedTrash.size > 0 && (
                <>
                  <span className="text-xs" style={{ color: "var(--page-text)" }}>{t("sessions.selected_count", String(selectedTrash.size))}</span>
                  <button
                    onClick={handleBatchRestore}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium"
                    style={{ borderColor: "#10b981", color: "#10b981" }}
                  >
                    <Undo2 className="h-3 w-3" />
                    {t("sessions.restore_selected")}
                  </button>
                  <button
                    onClick={() => setPurgeTarget("batch")}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium"
                    style={{ borderColor: "#ef4444", color: "#ef4444" }}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t("sessions.delete_selected")}
                  </button>
                </>
              )}
            </div>
          )}

          {trash.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Trash2 className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
              <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("sessions.trash_empty")}</p>
            </div>
          ) : (
            trash.map((entry) => (
              <div
                key={entry.trashPath}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
                style={{
                  borderColor: selectedTrash.has(entry.trashPath) ? "#3b82f6" : "var(--card-border)",
                  backgroundColor: "var(--card-bg)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTrash.has(entry.trashPath)}
                  onChange={() => toggleTrashSelect(entry.trashPath)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--page-text)" }}>
                    {entry.sessionName || entry.fileName.replace(/\.jsonl$/, "")}
                  </p>
                  <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: "var(--muted-text)" }}>
                    <span style={{ color: "#ef4444" }}>{t("sessions.trashed_at", formatRelativeDate(entry.trashedAt, t))}</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {entry.messageCount}
                    </span>
                    <span className="truncate">{entry.fileName}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(entry.trashPath)}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium shrink-0"
                  style={{ borderColor: "#10b981", color: "#10b981" }}
                >
                  <Undo2 className="h-3 w-3" />
                  {t("sessions.restore")}
                </button>
                <button
                  onClick={() => setPurgeTarget(entry)}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium shrink-0"
                  style={{ borderColor: "#ef4444", color: "#ef4444" }}
                >
                  <Trash2 className="h-3 w-3" />
                  {t("sessions.delete_forever")}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Move-to-Trash Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={t("sessions.delete_title")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <div>
              <p className="text-sm" style={{ color: "var(--page-text)" }}>
                {t("sessions.delete_confirm")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted-text)" }}>
                {deleteTarget?.session.name || deleteTarget?.session.fileName}
              </p>
              {deleteTarget?.session.messageCount && (
                <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>
                  {t("sessions.messages", String(deleteTarget.session.messageCount))} · {formatFullTimestamp(deleteTarget.session.lastActive || deleteTarget.session.timestamp)}
                </p>
              )}
              <p className="text-xs mt-2" style={{ color: "var(--subtle-text)" }}>
                {t("sessions.delete_to_trash_note")}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--muted-text)" }}
            >
              {t("sessions.cancel")}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              {deleting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {t("sessions.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t("sessions.delete")}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Permanent-Delete Confirmation Modal */}
      <Modal
        open={!!purgeTarget}
        onClose={() => !purging && setPurgeTarget(null)}
        title={t("sessions.delete_forever")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <div>
              <p className="text-sm" style={{ color: "var(--page-text)" }}>
                {t("sessions.delete_forever_confirm")}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted-text)" }}>
                {purgeTarget === "batch"
                  ? t("sessions.selected_count", String(selectedTrash.size))
                  : purgeTarget?.sessionName || purgeTarget?.fileName}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setPurgeTarget(null)}
              disabled={purging}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--muted-text)" }}
            >
              {t("sessions.cancel")}
            </button>
            <button
              onClick={handlePurge}
              disabled={purging}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              {purging ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {t("sessions.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {t("sessions.delete_forever")}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Session Preview Modal */}
      <Modal
        open={!!previewTarget}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget ? sessionDisplayName(previewTarget) : t("sessions.preview_title")}
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto space-y-2.5">
          {previewError ? (
            <p className="text-sm py-6 text-center" style={{ color: "#ef4444" }}>{t("sessions.preview_failed")}</p>
          ) : !preview ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
            </div>
          ) : preview.messages.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--muted-text)" }}>{t("sessions.preview_empty")}</p>
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--subtle-text)" }}>
                {t("sessions.preview_total", String(preview.total), String(preview.messages.length))}
              </p>
              {preview.messages.map((m, i) => (
                <div
                  key={i}
                  className="rounded-lg border px-3.5 py-2.5"
                  style={{
                    backgroundColor: "var(--card-bg)",
                    borderColor: m.role === "user" ? "rgba(59,130,246,0.4)" : "var(--card-border)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: m.role === "user" ? "rgba(59,130,246,0.15)" : "var(--accent-bg)",
                        color: m.role === "user" ? "#3b82f6" : "var(--sidebar-active-text)",
                      }}
                    >
                      {m.role}
                    </span>
                    {m.timestamp && (
                      <span className="text-[10px]" style={{ color: "var(--subtle-text)" }}>
                        {new Date(m.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed break-words" style={{ color: "var(--page-text)" }}>
                    {m.text || "—"}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
