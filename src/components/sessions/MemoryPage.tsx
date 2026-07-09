import { useState, useEffect } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Brain, User, AlertTriangle, Clock, FileText } from "lucide-react";

interface MemoryFile {
  name: string;
  filename: string;
  content: string;
  updatedAt: string;
}

const FILE_ICONS: Record<string, typeof Brain> = {
  "MEMORY.md": Brain,
  "USER.md": User,
  "failures.md": AlertTriangle,
};

const FILE_COLORS: Record<string, string> = {
  "MEMORY.md": "#3b82f6",
  "USER.md": "#10b981",
  "failures.md": "#ef4444",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mdToHtml(text: string): string {
  return text
    // Headings
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-2" style="color:var(--page-text)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-bold mt-5 mb-2" style="color:var(--page-text)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-5 mb-3" style="color:var(--page-text)">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--page-text)">$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="text-xs px-1 py-0.5 rounded" style="background:var(--accent-bg);color:var(--sidebar-active-text)">$1</code>')
    // Section separator § → horizontal rule
    .replace(/^§\s*$/gm, '<hr style="border-color:var(--card-border);margin:12px 0" />')
    // List items (must be after other inline patterns)
    .replace(/^- (.+)$/gm, '<li class="text-sm ml-4" style="color:var(--page-text);list-style:disc">$1</li>')
    // Comments: <!-- ... -->
    .replace(/<!-- (.+?) -->/g, '<span class="text-xs ml-2" style="color:var(--subtle-text)">// $1</span>')
    // Double line breaks to paragraphs
    .replace(/\n\n/g, '</p><p class="text-sm leading-relaxed" style="color:var(--page-text)">')
    // Single line breaks within paragraphs
    .replace(/\n/g, '<br />')
    // Wrap everything in paragraph if not already wrapped
    .replace(/^(?!<[hp])/m, '<p class="text-sm leading-relaxed" style="color:var(--page-text)">')
    .replace(/([^>])$/m, '$1</p>');
}

function MemoryCard({ file }: { file: MemoryFile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const Icon = FILE_ICONS[file.filename] || FileText;
  const color = FILE_COLORS[file.filename] || "#6b7280";
  const lineCount = file.content.split("\n").length;

  if (!file.content) {
    return null;
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--card-border)" }}>
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4"
        style={{ backgroundColor: "var(--card-bg)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}15` }}>
            <Icon className="h-4 w-4" style={{ color }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold" style={{ color: "var(--page-text)" }}>{t("memory." + file.filename.replace("MEMORY.md", "project_memories").replace("USER.md", "user_profile").replace("failures.md", "failure_records"))}</h3>
            <p className="text-xs" style={{ color: "var(--muted-text)" }}>
              {t("memory.lines", String(lineCount))} · {t("memory.updated", formatDate(file.updatedAt))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color }}>
            {file.filename}
          </span>
          <Clock className="h-3.5 w-3.5" style={{ color: "var(--muted-text)" }} />
        </div>
      </button>

      {/* Content */}
      {open && (
        <div className="px-6 py-4" style={{ borderTop: "1px solid var(--card-border)", backgroundColor: "var(--page-bg)" }}>
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: mdToHtml(file.content) }}
            style={{ color: "var(--page-text)" }}
          />
        </div>
      )}
    </div>
  );
}

export function MemoryPage() {
  const { t } = useTranslation();
  const { initialized } = useConfigStore();
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) return;
    setLoading(true);
    fetch("/api/pi/memory")
      .then((r) => r.json())
      .then((data) => {
        setFiles(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [initialized]);

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
        <p className="text-sm text-red-400">Failed to load memory: {error}</p>
      </div>
    );
  }

  const totalLines = files.reduce((s, f) => s + f.content.split("\n").length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>{t("memory.title")}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
          {t("memory.summary", String(totalLines), String(files.length))}
        </p>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Brain className="h-12 w-12" style={{ color: "var(--subtle-text)" }} />
          <p className="mt-4 text-sm" style={{ color: "var(--muted-text)" }}>{t("memory.no_memory")}</p>
          <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>{t("memory.no_memory_desc")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {files.map((file) => (
            <MemoryCard key={file.filename} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
