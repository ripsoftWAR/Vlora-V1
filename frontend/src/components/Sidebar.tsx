import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, Sparkles, MessageSquare, Trash2, PanelLeftClose, PanelLeftOpen, RotateCcw } from 'lucide-react';

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
  onNewChat: () => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({
  open, collapsed, onClose, onToggleCollapse, onNewChat,
  sessions, activeSessionId, onSwitchSession, onDeleteSession,
}: Props) {
  const [undoSession, setUndoSession] = useState<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Cleanup undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoSession) clearTimeout(undoSession.timer);
    };
  }, [undoSession]);

  const handleDeleteWithUndo = (sessionId: string) => {
    // Kalau ada undo sebelumnya, cancel
    if (undoSession) {
      clearTimeout(undoSession.timer);
      setUndoSession(null);
    }

    // Hapus session
    onDeleteSession(sessionId);

    // Tawarkan undo dalam 4 detik
    const timer = setTimeout(() => {
      setUndoSession(null);
    }, 4000);

    setUndoSession({ id: sessionId, timer });
  };

  const handleUndoDelete = () => {
    if (!undoSession) return;
    clearTimeout(undoSession.timer);
    setUndoSession(null);
    // Switch ke session yang di-undo
    onSwitchSession(undoSession.id);
  };

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
          flex flex-col backdrop-blur-2xl
          border-r
          transition-all duration-300 ease-out
          ${collapsed ? 'lg:w-[56px]' : 'w-[260px] lg:w-[260px]'}
          ${open
            ? 'translate-x-0'
            : '-translate-x-full lg:translate-x-0'
          }
        `}
        style={{
          background: 'var(--bg-sidebar)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* ── COLLAPSED MODE ── */}
        {collapsed ? (
          <>
            {/* Logo mini */}
            <div className="flex justify-center pt-4 pb-3">
              <button
                onClick={onToggleCollapse}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: 'var(--bg-badge)' }}
                aria-label="Lebarkan sidebar"
                title="Lebarkan sidebar"
              >
                <Sparkles size={15} style={{ color: 'var(--text-primary)' }} aria-hidden="true" />
              </button>
            </div>

            <div className="mx-3 h-px" style={{ background: 'var(--border-subtle)' }} />

            {/* New chat icon */}
            <div className="flex justify-center py-3">
              <button
                onClick={() => { onNewChat(); onClose(); }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                aria-label="Chat baru"
                title="Chat baru"
              >
                <MessageSquarePlus size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Expand button */}
            <div className="flex justify-center py-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                onClick={onToggleCollapse}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; }}
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
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                       style={{ background: 'var(--bg-badge)' }}>
                    <Sparkles size={15} style={{ color: 'var(--text-primary)' }} aria-hidden="true" />
                  </div>
                  <span className="text-[14px] font-medium tracking-tight whitespace-nowrap"
                        style={{ color: 'var(--text-primary)' }}>Vlora AI</span>
                </div>
                <div className="flex items-center gap-1">
                  {/* Desktop: collapse toggle */}
                  <button
                    onClick={onToggleCollapse}
                    aria-label="Perkecil sidebar"
                    className="hidden lg:flex p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <PanelLeftClose size={16} />
                  </button>
                  {/* Mobile: close button */}
                  <button
                    onClick={onClose}
                    aria-label="Tutup sidebar"
                    className="lg:hidden p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <PanelLeftClose size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-4 h-px" style={{ background: 'var(--border-subtle)' }} />

            {/* Divider */}
            <div className="mx-4 h-px" style={{ background: 'var(--border-subtle)' }} />

            {/* New Chat button */}
            <div className="px-3 py-3">
              <button
                onClick={() => { onNewChat(); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                           transition-all duration-200 text-[13px]
                           focus-visible:outline-none focus-visible:ring-1"
                style={{ color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
              >
                <MessageSquarePlus size={15} aria-hidden="true" />
                <span>Chat baru</span>
              </button>
            </div>

            {/* Divider */}
            <div className="mx-4 h-px" style={{ background: 'var(--border-subtle)' }} />

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <h2 className="text-[11px] font-medium uppercase tracking-wider px-3 mb-2"
                  style={{ color: 'var(--text-primary)' }}>
                Riwayat Chat
              </h2>

              {sessions.length === 0 ? (
                <p className="text-[12px] px-3 py-4 text-center" style={{ color: '#6b6b6b' }}>
                  Belum ada riwayat
                </p>
              ) : (
                <div className="space-y-0.5">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="group/item flex items-center gap-2.5 px-3 py-2 rounded-lg
                                 cursor-pointer transition-all duration-150"
                      style={{
                        background: s.id === activeSessionId ? 'var(--bg-hover)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                      onMouseEnter={(e) => { if (s.id !== activeSessionId) { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
                      onMouseLeave={(e) => { if (s.id !== activeSessionId) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
                      onClick={() => { onSwitchSession(s.id); onClose(); }}
                    >
                      <MessageSquare size={13} className="flex-shrink-0" />
                      <span className="flex-1 text-[12px] truncate leading-snug">
                        {s.title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteWithUndo(s.id);
                        }}
                        aria-label={`Hapus sesi: ${s.title}`}
                        className="p-0.5 rounded opacity-0 group-hover/item:opacity-100 transition-all"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#f87171'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Undo toast */}
            <AnimatePresence>
              {undoSession && (
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="mx-3 mb-2 px-3 py-2.5 rounded-lg flex items-center gap-2"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
                >
                  <span className="flex-1 text-[12px]" style={{ color: 'var(--text-primary)' }}>
                    Session dihapus
                  </span>
                  <button
                    onClick={handleUndoDelete}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] transition-all"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <RotateCcw size={11} />
                    Undo
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[9px] text-center" style={{ color: '#6b6b6b' }}>
                Project Analyst & Engineer Agent
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
