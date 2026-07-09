import { useEffect, useState } from 'react';
import {
  FileText, Pencil, Wrench, Trash2, FolderOpen, Search,
  FileSearch, Terminal, FlaskConical, Palette, BookOpen,
  Loader2, Sparkles,
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
        flex items-center gap-[13px] px-[18px] py-[11px]
        rounded-xl backdrop-blur-2xl
        border transition-all duration-500 ease-out
        ${isActive
          ? 'opacity-100 translate-y-0 scale-100 border-white/[0.06] bg-black/70'
          : 'opacity-0 -translate-y-3 scale-97 border-white/[0.03] bg-black/50'
        }
      `}
    >
      {/* Simple dot indicator */}
      <div className="relative flex items-center justify-center" aria-hidden="true">
        <div
          className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
          style={{ background: `rgba(255,255,255,0.06)` }}
        >
          {isActive ? (
            <Loader2 size={14} className="animate-spin text-white/40" />
          ) : (
            <Icon size={14} className="text-white/30" />
          )}
        </div>
      </div>

      {/* Label */}
      <span className="text-[14px] text-white/50">
        {isActive ? config.label : 'Selesai'}
      </span>
    </div>
  );
}
