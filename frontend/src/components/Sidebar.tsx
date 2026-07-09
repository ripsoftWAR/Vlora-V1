import { useRef } from 'react';
import { FolderOpen, MessageSquarePlus, Sparkles, MessageSquare, Trash2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface Props {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
  selectedPath: string;
  onFolderUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNewChat: () => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({
  open, collapsed, onClose, onToggleCollapse, selectedPath, onFolderUpload, onNewChat,
  sessions, activeSessionId, onSwitchSession, onDeleteSession,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      {/* Sidebar — full mode */}
      <aside
        role="navigation"
        aria-label="Sidebar navigasi"
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          flex flex-col bg-white/[0.02] backdrop-blur-2xl
          border-r border-white/[0.04]
          transition-all duration-300 ease-out
          ${collapsed ? 'lg:w-[56px]' : 'w-[260px] lg:w-[260px]'}
          ${open
            ? 'translate-x-0'
            : '-translate-x-full lg:translate-x-0'
          }
        `}
      >
        {/* ── COLLAPSED MODE ── */}
        {collapsed ? (
          <>
            {/* Logo mini */}
            <div className="flex justify-center pt-4 pb-3">
              <button
                onClick={onToggleCollapse}
                className="w-8 h-8 rounded-xl bg-white/[0.08] flex items-center justify-center
                           hover:bg-white/[0.12] transition-colors"
                aria-label="Lebarkan sidebar"
                title="Lebarkan sidebar"
              >
                <Sparkles size={15} className="text-white/50" aria-hidden="true" />
              </button>
            </div>

            <div className="mx-3 h-px bg-white/[0.04]" />

            {/* Upload icon */}
            <div className="flex justify-center py-3">
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
                className="p-2 rounded-lg text-white/25 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
                aria-label="Buka folder"
                title="Buka folder"
              >
                <FolderOpen size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="mx-3 h-px bg-white/[0.04]" />

            {/* New chat icon */}
            <div className="flex justify-center py-3">
              <button
                onClick={() => { onNewChat(); onClose(); }}
                className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.06]
                           border border-white/[0.06] hover:border-white/[0.1] transition-colors"
                aria-label="Chat baru"
                title="Chat baru"
              >
                <MessageSquarePlus size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Expand button */}
            <div className="flex justify-center py-3 border-t border-white/[0.03]">
              <button
                onClick={onToggleCollapse}
                className="p-2 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
                aria-label="Lebarkan sidebar"
                title="Lebarkan sidebar"
              >
                <PanelLeftOpen size={16} />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ── EXPANDED MODE ── */}

            {/* Header */}
            <div className="px-4 pt-4 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <Sparkles size={15} className="text-white/50" aria-hidden="true" />
                  </div>
                  <span className="text-[14px] font-medium text-white/60 tracking-tight whitespace-nowrap">Vlora AI</span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Desktop: collapse toggle */}
                  <button
                    onClick={onToggleCollapse}
                    aria-label="Perkecil sidebar"
                    className="hidden lg:flex p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
                  >
                    <PanelLeftClose size={16} />
                  </button>
                  {/* Mobile: close button */}
                  <button
                    onClick={onClose}
                    aria-label="Tutup sidebar"
                    className="lg:hidden p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
                  >
                    <PanelLeftClose size={16} />
                  </button>
                </div>
              </div>

              {/* Provider & developer badge — hidden for now */}
              {/* <div className="mt-2 ml-[42px] flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-emerald-400/35 flex-shrink-0" />
                  <span className="text-[11px] text-white/25 tracking-wide">DeepSeek</span>
                </div>
                <span className="text-[9px] text-white/10">powered by finework.id</span>
              </div> */}
            </div>

            {/* Divider */}
            <div className="mx-4 h-px bg-white/[0.04]" />

            {/* Actions */}
            <div className="px-3 py-3 space-y-1">
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
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                           text-white/30 hover:text-white/55 hover:bg-white/[0.04]
                           transition-all duration-200 text-[13px]
                           focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              >
                <FolderOpen size={15} aria-hidden="true" />
                <span>Buka folder</span>
              </button>

              {selectedPath && (
                <p className="px-3 py-1 text-[11px] text-white/15 truncate" title={selectedPath}>
                  📁 {selectedPath}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="mx-4 h-px bg-white/[0.04]" />

            {/* New Chat button */}
            <div className="px-3 py-3">
              <button
                onClick={() => { onNewChat(); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                           text-white/40 hover:text-white/70 hover:bg-white/[0.06]
                           border border-white/[0.06] hover:border-white/[0.1]
                           transition-all duration-200 text-[13px]
                           focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              >
                <MessageSquarePlus size={15} aria-hidden="true" />
                <span>Chat baru</span>
              </button>
            </div>

            {/* Divider */}
            <div className="mx-4 h-px bg-white/[0.04]" />

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <h2 className="text-[11px] font-medium text-white/25 uppercase tracking-wider px-3 mb-2">
                Riwayat Chat
              </h2>

              {sessions.length === 0 ? (
                <p className="text-[12px] text-white/15 px-3 py-4 text-center">
                  Belum ada riwayat
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`
                        group/item flex items-center gap-2.5 px-3 py-2 rounded-lg
                        cursor-pointer transition-all duration-150
                        ${s.id === activeSessionId
                          ? 'bg-white/[0.06] text-white/70'
                          : 'text-white/30 hover:text-white/50 hover:bg-white/[0.03]'
                        }
                      `}
                      onClick={() => { onSwitchSession(s.id); onClose(); }}
                    >
                      <MessageSquare size={13} className="flex-shrink-0" />
                      <span className="flex-1 text-[12px] truncate leading-snug">
                        {s.title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(s.id);
                        }}
                        aria-label={`Hapus sesi: ${s.title}`}
                        className="p-0.5 rounded text-white/10 hover:text-red-400
                                   opacity-0 group-hover/item:opacity-100 transition-all"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-white/[0.03]">
              <p className="text-[9px] text-white/10 text-center">
                Project Analyst & Engineer Agent
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
