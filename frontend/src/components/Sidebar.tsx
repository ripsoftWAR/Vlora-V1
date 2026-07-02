import { useState, useRef } from 'react';
import {
  FolderOpen, MessageSquarePlus, X, ChevronRight,
  Sparkles, Layers,
} from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  project: {
    totalFiles: number;
    techStack: string[];
    skills: string[];
    files?: FileNode[];
  };
  selectedPath: string;
  onFolderUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNewChat: () => void;
}

export default function Sidebar({ open, onClose, project, selectedPath, onFolderUpload, onNewChat }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const techStack = project.techStack?.length ? project.techStack : ['Node.js', 'React', 'TypeScript', 'Express'];

  return (
    <>
      {/* Overlay (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label="Sidebar navigasi"
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-[260px]
          flex flex-col bg-white/[0.03] backdrop-blur-2xl
          border-r border-white/[0.06]
          transition-transform duration-300 ease-out
          lg:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="p-5 pb-4 border-b border-white/[0.05]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500
                          flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Sparkles size={16} className="text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-slate-200 tracking-tight truncate">
                Analyst Agent
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" aria-hidden="true" />
                <span className="text-xs font-mono text-white/40">llama-3.3-70b</span>
              </div>
            </div>
            {/* Close (mobile) */}
            <button
              onClick={onClose}
              aria-label="Tutup sidebar"
              className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-white/30
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-1">
          {/* Project Section */}
          <Section title="Project">
            <input
              ref={fileInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is valid
              webkitdirectory=""
              multiple
              className="hidden"
              onChange={onFolderUpload}
              aria-label="Pilih folder project"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 mx-3
                         rounded-xl text-[12px] font-medium
                         bg-indigo-500/[0.08] border border-indigo-400/20
                         text-indigo-300 hover:bg-indigo-500/[0.14]
                         transition-all duration-200
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
            >
              <FolderOpen size={14} aria-hidden="true" />
              <span>Pilih Folder Project</span>
            </button>

            {selectedPath && (
              <div className="flex items-center gap-2 mx-3 mt-2 px-2.5 py-1.5
                            rounded-lg bg-white/[0.03] text-xs text-white/55">
                <span aria-hidden="true">📁</span>
                <span className="truncate font-mono">{selectedPath}</span>
              </div>
            )}

            {project.totalFiles > 0 && (
              <p className="px-4 mt-1.5 text-xs text-white/40">
                {project.totalFiles} file terdeteksi
              </p>
            )}

            {/* File Tree */}
            <div className="mt-2 px-3" role="tree" aria-label="Struktur file project">
              <FileTree nodes={project.files || []} />
            </div>
          </Section>

          {/* Tech Stack */}
          <Section title="Tech Stack">
            <div className="flex flex-wrap gap-1.5 px-3">
              {techStack.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-md text-xs font-medium
                           bg-white/[0.04] border border-white/[0.06] text-white/45"
                >
                  {t}
                </span>
              ))}
            </div>
          </Section>

          {/* Active Skills */}
          {project.skills?.length > 0 && (
            <Section title={`Skills (${project.skills.length})`}>
              <div className="space-y-0.5 px-3">
                {project.skills.map((s) => (
                  <div
                    key={s}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg
                             text-xs text-white/40"
                  >
                    <Layers size={12} className="text-indigo-400/60" aria-hidden="true" />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/[0.05]">
          <button
            onClick={onNewChat}
            aria-label="Mulai chat baru"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5
                       rounded-xl text-[12px] font-medium text-white/35
                       bg-white/[0.03] border border-white/[0.06]
                       hover:bg-white/[0.06] hover:text-white/55
                       transition-all duration-200
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
          >
            <MessageSquarePlus size={14} aria-hidden="true" />
            <span>Chat baru</span>
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Section ──────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <h3 className="px-4 py-1.5 text-xs font-semibold text-white/40
                     tracking-[0.1em] uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── File Tree ────────────────────────────────────────────────
function FileTree({ nodes, depth = 0 }: { nodes: FileNode[]; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const toggle = (name: string, type: 'file' | 'dir') => {
    if (type === 'dir') {
      setOpen((p) => ({ ...p, [name]: !p[name] }));
    }
  };

  return (
    <>
      {nodes.map((n) => (
        <div key={n.name}>
          <div
            role="treeitem"
            aria-expanded={n.type === 'dir' ? open[n.name] || false : undefined}
            aria-selected={false}
            tabIndex={0}
            onClick={() => toggle(n.name, n.type)}
            onKeyDown={(e) => {
              if (n.type === 'dir' && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                toggle(n.name, n.type);
              }
              if (e.key === 'ArrowRight' && n.type === 'dir' && !open[n.name]) {
                e.preventDefault();
                setOpen((p) => ({ ...p, [n.name]: true }));
              }
              if (e.key === 'ArrowLeft' && n.type === 'dir' && open[n.name]) {
                e.preventDefault();
                setOpen((p) => ({ ...p, [n.name]: false }));
              }
            }}
            className={`
              flex items-center gap-1.5 py-[3px] rounded-md
              text-xs cursor-pointer select-none
              transition-colors duration-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:ring-inset
              ${n.type === 'dir' ? 'text-white/60 hover:text-white/85' : 'text-white/35 hover:text-white/55'}
            `}
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            {n.type === 'dir' ? (
              <ChevronRight
                size={11}
                aria-hidden="true"
                className={`text-white/40 transition-transform ${open[n.name] ? 'rotate-90' : ''}`}
              />
            ) : (
              <span className="w-[11px] text-center text-white/15" aria-hidden="true">·</span>
            )}
            <span className={n.type === 'file' ? 'font-mono text-xs' : 'font-medium'}>
              {n.name}
            </span>
          </div>
          {n.type === 'dir' && open[n.name] && n.children && (
            <div role="group">
              <FileTree nodes={n.children} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
