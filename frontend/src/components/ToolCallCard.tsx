import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, X, ChevronDown, Copy, Check as CheckIcon } from 'lucide-react';
import { TOOL_META } from '../App';

interface Props {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
  args?: Record<string, unknown>;
  step?: number;
}

const cardVariants = {
  hidden: { opacity: 0, x: -10, scale: 0.94 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 500, damping: 28 },
  },
};

/**
 * Truncate string dengan ellipsis — aman untuk semua tipe data
 */
function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '…';
}

/**
 * Format preview berdasarkan tipe tool untuk tampilan ringkas
 */
function formatPreview(name: string, raw: string): string {
  if (!raw) return '';

  // read_file / read_multiple_files: tampilkan nama file
  if (name === 'read_file' || name === 'read_multiple_files') {
    const match = raw.match(/^=== (.+?) ===/m);
    if (match) return match[1];
    return truncate(raw, 50);
  }

  // write_file / edit_file: status ✅/❌
  if (name === 'write_file' || name === 'edit_file') {
    if (raw.startsWith('✅')) return 'Berhasil';
    if (raw.startsWith('❌')) return 'Gagal';
    return truncate(raw, 50);
  }

  // run_command: ambil baris pertama output
  if (name === 'run_command') {
    const lines = raw.split('\n');
    const firstOutput = lines.find(l => l && !l.startsWith('$ '));
    return firstOutput ? truncate(firstOutput, 60) : 'OK';
  }

  // search_in_files / find_files: jumlah hasil
  if (name === 'search_in_files' || name === 'find_files') {
    const count = (raw.match(/📄|•/g) || []).length;
    return `${count} hasil`;
  }

  // list_files: rangkuman
  if (name === 'list_files') {
    return 'Struktur project';
  }

  // Default: ambil 60 karakter pertama
  return truncate(raw.replace(/\n/g, ' '), 60);
}

export default function ToolCallCard({ name, status, preview, args, step }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = TOOL_META[name] || { icon: '⚙️', label: name, color: '#9ca3af' };
  const isDone = status === 'done';
  const isRunning = status === 'running';

  const displayPreview = formatPreview(name, preview || '');

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }, [preview]);

  const hasDetail = !!preview || !!args;

  return (
    <motion.div
      role="status"
      aria-label={`Tool ${config.label}: ${isRunning ? 'sedang berjalan' : isDone ? 'selesai' : 'gagal'}${displayPreview ? ` — ${displayPreview}` : ''}`}
      variants={cardVariants}
      layout
      className={`
        group/tc relative
        rounded-lg border transition-all duration-200
        ${isDone
          ? 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.10]'
          : isRunning
            ? 'bg-white/[0.05] border-white/[0.10]'
            : 'bg-red-500/[0.06] border-red-500/20'
        }
        ${hasDetail && isDone ? 'cursor-pointer' : ''}
      `}
      onClick={() => hasDetail && isDone && setExpanded(!expanded)}
    >
      {/* ── Header row ────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Step number */}
        {step !== undefined && (
          <span className="text-[10px] font-mono text-white/25 w-4 text-right flex-shrink-0">
            {step}
          </span>
        )}

        {/* Status icon */}
        <div className="flex-shrink-0">
          {isRunning ? (
            <Loader2 size={13} className="animate-spin" style={{ color: config.color }} aria-hidden="true" />
          ) : isDone ? (
            <Check size={13} style={{ color: config.color }} aria-hidden="true" />
          ) : (
            <X size={13} className="text-red-400" aria-hidden="true" />
          )}
        </div>

        {/* Icon emoji */}
        <span className="text-xs flex-shrink-0" aria-hidden="true">{config.icon}</span>

        {/* Label */}
        <span
          className="text-[11.5px] font-medium flex-shrink-0"
          style={{ color: isDone ? config.color : isRunning ? 'white' : undefined }}
        >
          {config.label}
        </span>

        {/* Preview — ringkas */}
        {displayPreview && isDone && (
          <span className="text-[11px] text-white/35 truncate min-w-0">
            · {displayPreview}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Actions — hover reveal */}
        {isDone && preview && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/tc:opacity-100 transition-opacity duration-150">
            <button
              onClick={handleCopy}
              aria-label="Salin output tool"
              className="p-1 rounded hover:bg-white/[0.08] text-white/30 hover:text-white/60 transition-colors"
            >
              {copied ? <CheckIcon size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
            {hasDetail && (
              <motion.span
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="p-1 text-white/30"
              >
                <ChevronDown size={12} />
              </motion.span>
            )}
          </div>
        )}

        {/* Running pulse dot */}
        {isRunning && (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
            style={{ backgroundColor: config.color }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* ── Expanded detail ───────────────────────────────── */}
      <AnimatePresence>
        {expanded && isDone && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0 space-y-2 border-t border-white/[0.04] mx-3">
              {/* Arguments / Parameters */}
              {args && Object.keys(args).length > 0 && (
                <div>
                  <span className="text-[10px] text-white/30 uppercase tracking-wider font-mono">
                    Parameters
                  </span>
                  <pre className="mt-1 text-[11px] font-mono text-white/50 bg-black/30 rounded-md p-2 overflow-x-auto max-h-[120px]">
                    {JSON.stringify(args, null, 2)}
                  </pre>
                </div>
              )}

              {/* Output / Result */}
              {preview && (
                <div>
                  <span className="text-[10px] text-white/30 uppercase tracking-wider font-mono">
                    Output
                  </span>
                  <pre className="mt-1 text-[11px] font-mono text-white/60 bg-black/30 rounded-md p-2 overflow-x-auto max-h-[200px] whitespace-pre-wrap break-all">
                    {preview}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
