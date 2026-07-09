import { useState, useEffect } from "react";
import { useConfigStore } from "@/store/config-store";
import { formatDateFull } from "@/lib/utils";
import { History, MessageSquare, Clock, ChevronDown, ChevronRight, Trash2, AlertTriangle, Shield } from "lucide-react";
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

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ProjectCard({
  group,
  defaultOpen,
  onDelete,
}: {
  group: ProjectGroup;
  defaultOpen: boolean;
  onDelete: (session: SessionInfo, groupPath: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [deleting, setDeleting] = useState<string | null>(null);

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
              {group.totalSessions} sessions · Last active {new Date(group.lastActive).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium" style={{ color: "var(--sidebar-active-text)" }}>
            {group.totalSessions}
          </span>
          {open ? <ChevronDown className="h-4 w-4" style={{ color: "var(--muted-text)" }} /> : <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-text)" }} />}
        </div>
      </button>

      {/* Session List */}
      {open && (
        <div style={{ borderTop: "1px solid var(--card-border)" }}>
          {group.sessions.map((session) => (
            <div
              key={session.id || session.fileName}
              className="flex items-center justify-between px-6 py-3"
              style={{
                borderBottom: "1px solid var(--card-border)",
                backgroundColor: "var(--page-bg)",
                opacity: deleting === session.fileName ? 0.5 : 1,
              }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex flex-col items-center justify-center w-8 h-8 rounded-md" style={{ backgroundColor: "var(--accent-bg)" }}>
                  <MessageSquare className="h-3.5 w-3.5" style={{ color: "var(--sidebar-active-text)" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--page-text)" }}>
                    {session.name || session.fileName.replace(/\.jsonl$/, "").split("_").pop() || session.id.slice(0, 12)}
                  </p>
                  <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted-text)" }}>
                    <span>{formatDateFull(session.timestamp)}</span>
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
                {isRecent(session.lastActive) ? (
                  <span
                    className="rounded-lg p-1.5"
                    style={{ color: "var(--subtle-text)" }}
                    title="Updated in the last 3 days — cannot delete"
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
                    title="Delete session"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionsPage() {
  const { initialized } = useConfigStore();
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ session: SessionInfo; groupPath: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSessions = () => {
    if (!initialized) return;
    setLoading(true);
    fetch("/api/pi/sessions")
      .then((r) => r.json())
      .then((data) => {
        setGroups(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSessions();
  }, [initialized]);

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
        loadSessions(); // refresh the list
      } else {
        alert("Failed to delete session file");
      }
    } catch {
      alert("Error deleting session");
    } finally {
      setDeleting(false);
    }
  };

  const filteredGroups = filter
    ? groups.filter((g) =>
        g.projectName.toLowerCase().includes(filter.toLowerCase())
      )
    : groups;

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
        <p className="text-sm" style={{ color: "var(--error-text, #ef4444)" }}>Failed to load sessions: {error}</p>
      </div>
    );
  }

  const totalSessions = groups.reduce((s, g) => s + g.totalSessions, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>Sessions</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
          {totalSessions} sessions across {groups.length} projects
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by project name..."
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
            <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>No sessions found</p>
          </div>
        ) : (
          filteredGroups.map((group, i) => (
            <ProjectCard
              key={group.projectPath}
              group={group}
              defaultOpen={i < 3}
              onDelete={(session, groupPath) => setDeleteTarget({ session, groupPath })}
            />
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Session"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <div>
              <p className="text-sm" style={{ color: "var(--page-text)" }}>
                Are you sure you want to delete this session?
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted-text)" }}>
                {deleteTarget?.session.name || deleteTarget?.session.fileName}
              </p>
              {deleteTarget?.session.messageCount && (
                <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>
                  {deleteTarget.session.messageCount} messages · {formatDateFull(deleteTarget.session.timestamp)}
                </p>
              )}
              <p className="text-xs mt-2" style={{ color: "var(--subtle-text)" }}>
                This will permanently delete the session file from disk.
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
              Cancel
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
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
