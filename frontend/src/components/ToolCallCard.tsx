import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TOOL_META } from '../App';

interface Props {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
  args?: Record<string, unknown>;
  description?: string;
  step?: number;
}

export default function ToolCallCard({ name, status, preview, args, description, step: _step }: Props) {
  const [expanded, setExpanded] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const config = TOOL_META[name] || { icon: '⚙️', label: name, color: '#9ca3af' };
  const isDone = status === 'done';
  const isRunning = status === 'running';
  const hasDetail = !!preview || !!args;

  // ── Timer untuk running tool ──────────────────────────────
  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
      return () => clearInterval(interval);
    }
    if (isDone && startTimeRef.current) {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }
  }, [isRunning, isDone]);

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
          flex items-center gap-[7px] w-full text-left
          px-[9px] py-[5px] -mx-[5px] rounded-md
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

        {/* Label — nama tool */}
        <span className="text-[15px] font-medium flex-shrink-0"
          style={{ color: 'var(--text-secondary)' }}>
          {config.label}
        </span>

        {/* Description — teks natural yang menjelaskan apa yang dilakukan agent */}
        {description && (
          <span className="text-[14px] truncate italic"
            style={{ color: 'var(--text-tertiary)' }}>
            {description}
          </span>
        )}

        {/* Fallback preview (kalau description kosong) */}
        {!description && isDone && preview && (
          <span className="text-[14px] truncate italic"
            style={{ color: 'var(--text-tertiary)' }}>
            {preview.slice(0, 60)}
          </span>
        )}

        {/* Running pulse + timer */}
        {isRunning && (
          <>
            <span className="w-1 h-1 rounded-full animate-pulse flex-shrink-0"
              style={{ backgroundColor: config.color }} aria-hidden="true" />
            {elapsed > 0 && (
              <span className="text-[12px] font-mono"
                style={{ color: 'var(--text-tertiary)' }}>{elapsed}s</span>
            )}
          </>
        )}

        {/* Durasi setelah selesai */}
        {isDone && elapsed > 0 && (
          <span className="text-[12px] font-mono ml-auto"
            style={{ color: 'var(--text-tertiary)' }}>{elapsed}s</span>
        )}

        {/* Error indicator */}
        {status === 'error' && (
          <span className="text-[14px] text-red-400/70">gagal</span>
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
            <div className="ml-[13px] pl-[13px] py-[9px] space-y-[9px] border-l"
                 style={{ borderColor: 'var(--border-subtle)' }}>
              {args && Object.keys(args).length > 0 && (
                <div>
                  <span className="text-[12px] uppercase tracking-wider font-mono"
                        style={{ color: 'var(--text-tertiary)' }}>
                    Parameters
                  </span>
                  <pre className="mt-[2px] text-[13px] font-mono rounded-md p-[9px] overflow-x-auto max-h-[110px]"
                       style={{ color: 'var(--text-secondary)', background: 'var(--bg-code-block)' }}>
                    {JSON.stringify(args, null, 2)}
                  </pre>
                </div>
              )}

              {preview && (
                <div>
                  <span className="text-[12px] uppercase tracking-wider font-mono"
                        style={{ color: 'var(--text-tertiary)' }}>
                    Output
                  </span>
                  <pre className="mt-[2px] text-[13px] font-mono rounded-md p-[9px] overflow-x-auto max-h-[176px] whitespace-pre-wrap break-all"
                       style={{ color: 'var(--text-secondary)', background: 'var(--bg-code-block)' }}>
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
