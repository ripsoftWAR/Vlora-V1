import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TOOL_META } from '../App';

interface Props {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
  args?: Record<string, unknown>;
  step?: number;
}

/**
 * Format preview compact — hanya satu baris
 */
function formatPreview(name: string, raw: string): string {
  if (!raw) return '';

  if (name === 'read_file' || name === 'read_multiple_files') {
    const match = raw.match(/^=== (.+?) ===/m);
    return match ? match[1] : raw.slice(0, 50);
  }

  if (name === 'write_file' || name === 'edit_file') {
    if (raw.startsWith('✅')) return 'Berhasil';
    if (raw.startsWith('❌')) return 'Gagal';
    return raw.slice(0, 50);
  }

  if (name === 'run_command') {
    const lines = raw.split('\n');
    const firstOutput = lines.find(l => l && !l.startsWith('$ '));
    return firstOutput ? firstOutput.slice(0, 60) : 'OK';
  }

  if (name === 'search_in_files' || name === 'find_files') {
    const count = (raw.match(/📄|•/g) || []).length;
    return `${count} hasil`;
  }

  if (name === 'list_files') return 'Struktur project';

  return raw.replace(/\n/g, ' ').slice(0, 60);
}

export default function ToolCallCard({ name, status, preview, args, step: _step }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_META[name] || { icon: '⚙️', label: name, color: '#9ca3af' };
  const isDone = status === 'done';
  const isRunning = status === 'running';
  const displayPreview = formatPreview(name, preview || '');
  const hasDetail = !!preview || !!args;

  return (
    <motion.div
      role="status"
      aria-label={`${config.label}: ${isRunning ? 'berjalan' : isDone ? 'selesai' : 'gagal'}`}
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {/* ── Single-line compact row ────────────────────────── */}
      <button
        onClick={() => hasDetail && isDone && setExpanded(!expanded)}
        disabled={!hasDetail || !isDone}
        className={`
          flex items-center gap-1.5 w-full text-left
          px-2 py-1 -mx-1 rounded-md
          ${hasDetail && isDone
            ? 'cursor-pointer'
            : 'cursor-default'
          }
        `}
      >
        {/* Status dot — tiny, no icon */}
        <span className="flex-shrink-0 w-1 h-1 rounded-full mt-px"
          style={{ backgroundColor: isRunning ? config.color : isDone ? '#34d399' : '#f87171' }}
          aria-hidden="true"
        />

        {/* Label */}
        <span className={`text-xs font-medium italic ${isDone ? 'text-white/45' : 'text-white/65'}`}>
          {config.label}
        </span>

        {/* Preview inline */}
        {displayPreview && isDone && (
          <span className="text-[11px] text-white/25 truncate">
            {displayPreview}
          </span>
        )}

        {/* Running pulse */}
        {isRunning && (
          <>
            <span className="w-1 h-1 rounded-full animate-pulse flex-shrink-0"
              style={{ backgroundColor: config.color }} aria-hidden="true" />
            <span className="text-[10.5px] text-white/30 italic">berjalan...</span>
          </>
        )}

        {/* Error indicator */}
        {status === 'error' && (
          <span className="text-[10.5px] text-red-400/70">gagal</span>
        )}
      </button>

      {/* ── Expanded detail ────────────────────────────────── */}
      <AnimatePresence>
        {expanded && isDone && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-3 py-2 space-y-2 border-l border-white/[0.06]">
              {args && Object.keys(args).length > 0 && (
                <div>
                  <span className="text-[10px] text-white/25 uppercase tracking-wider font-mono">
                    Parameters
                  </span>
                  <pre className="mt-0.5 text-[11px] font-mono text-white/40 bg-black/25 rounded-md p-2 overflow-x-auto max-h-[100px]">
                    {JSON.stringify(args, null, 2)}
                  </pre>
                </div>
              )}

              {preview && (
                <div>
                  <span className="text-[10px] text-white/25 uppercase tracking-wider font-mono">
                    Output
                  </span>
                  <pre className="mt-0.5 text-[11px] font-mono text-white/50 bg-black/25 rounded-md p-2 overflow-x-auto max-h-[160px] whitespace-pre-wrap break-all">
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
