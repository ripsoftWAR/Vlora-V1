import { useEffect, useState } from 'react';
import {
  FileText, Pencil, Wrench, Trash2, FolderOpen, Search,
  FileSearch, Terminal, FlaskConical, Palette, BookOpen,
  Loader2, Sparkles, Zap,
} from 'lucide-react';

// ── Tool → Icon mapping ────────────────────────────────────────
const TOOL_ICONS: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  read_file:           { icon: FileText,       color: '#60a5fa', label: 'Membaca file' },
  read_multiple_files: { icon: BookOpen,       color: '#60a5fa', label: 'Membaca file' },
  write_file:          { icon: Pencil,         color: '#34d399', label: 'Menulis file' },
  edit_file:           { icon: Wrench,         color: '#fbbf24', label: 'Mengedit file' },
  delete_file:         { icon: Trash2,         color: '#f87171', label: 'Menghapus file' },
  list_files:          { icon: FolderOpen,     color: '#a78bfa', label: 'Memindai struktur' },
  find_files:          { icon: Search,         color: '#a78bfa', label: 'Mencari file' },
  search_in_files:     { icon: FileSearch,     color: '#a78bfa', label: 'Mencari dalam file' },
  run_command:         { icon: Terminal,       color: '#fbbf24', label: 'Menjalankan command' },
  detect_tech_stack:   { icon: FlaskConical,   color: '#34d399', label: 'Mendeteksi stack' },
  find_ui_components:  { icon: Palette,        color: '#f472b6', label: 'Mencari komponen UI' },
  fetch_docs:          { icon: BookOpen,       color: '#60a5fa', label: 'Mengambil dokumentasi' },
};

interface Props {
  toolName: string | null;
}

export default function RealtimeBadge({ toolName }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toolName) {
      setVisible(true);
    } else {
      // Delay hide for smooth exit
      const t = setTimeout(() => setVisible(false), 600);
      return () => clearTimeout(t);
    }
  }, [toolName]);

  if (!toolName && !visible) return null;

  const config = TOOL_ICONS[toolName || ''] || { icon: Sparkles, color: '#818cf8', label: toolName || 'Bekerja' };
  const Icon = config.icon;

  const isActive = !!toolName;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={isActive ? `Agent sedang: ${config.label}` : 'Agent selesai'}
      className={`
        fixed top-4 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-3 px-5 py-3
        rounded-2xl shadow-2xl backdrop-blur-2xl
        border transition-all duration-500 ease-out
        ${isActive
          ? 'opacity-100 translate-y-0 scale-100 border-white/15 bg-white/10 shadow-[0_0_30px_rgba(99,102,241,0.25)]'
          : 'opacity-0 -translate-y-4 scale-95 border-white/5 bg-white/5'
        }
      `}
    >
      {/* Pulsing ring */}
      <div className="relative flex items-center justify-center" aria-hidden="true">
        {isActive && (
          <>
            <div
              className="absolute w-8 h-8 rounded-full animate-ping opacity-30"
              style={{ backgroundColor: config.color }}
            />
            <div
              className="absolute w-10 h-10 rounded-full animate-pulse opacity-20"
              style={{ backgroundColor: config.color }}
            />
          </>
        )}
        <div
          className="relative w-8 h-8 rounded-xl flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${config.color}30, ${config.color}15)`,
            border: `1px solid ${config.color}40`,
            boxShadow: isActive ? `0 0 16px ${config.color}50` : 'none',
          }}
        >
          {isActive ? (
            <Loader2 size={16} style={{ color: config.color }} className="animate-spin" />
          ) : (
            <Icon size={16} style={{ color: config.color }} />
          )}
        </div>
      </div>

      {/* Label */}
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-white/55 tracking-widest uppercase">
          Agent Action
        </span>
        <span
          className="text-[13px] font-semibold tracking-tight"
          style={{ color: config.color }}
        >
          {config.label}
        </span>
      </div>

      {/* Sparkle */}
      {isActive && (
        <Zap
          size={12}
          className="animate-pulse ml-1"
          style={{ color: config.color }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
