import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Wrench, Clock } from 'lucide-react';
import ToolCallCard from './ToolCallCard';

interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
  args?: Record<string, unknown>;
}

interface Props {
  toolCalls: ToolCall[];
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

/**
 * Hitung statistik tool calls
 */
function useToolStats(toolCalls: ToolCall[]) {
  return useMemo(() => {
    const done = toolCalls.filter(t => t.status === 'done').length;
    const running = toolCalls.filter(t => t.status === 'running').length;
    const errors = toolCalls.filter(t => t.status === 'error').length;
    const total = toolCalls.length;
    return { done, running, errors, total };
  }, [toolCalls]);
}

/**
 * Hasilkan label ringkasan tool calls
 */
function summaryLabel(stats: ReturnType<typeof useToolStats>): string {
  const parts: string[] = [];
  if (stats.running > 0) parts.push(`${stats.running} berjalan`);
  if (stats.done > 0) parts.push(`${stats.done} selesai`);
  if (stats.errors > 0) parts.push(`${stats.errors} gagal`);
  if (parts.length === 0) parts.push(`${stats.total} tool`);
  return parts.join(' · ');
}

export default function ToolCallGroup({ toolCalls }: Props) {
  const [expanded, setExpanded] = useState(true); // default terbuka
  const stats = useToolStats(toolCalls);

  if (!toolCalls.length) return null;

  const isAllDone = stats.running === 0 && stats.total > 0;
  const hasRunning = stats.running > 0;

  return (
    <motion.div
      className="mb-[13px]"
      role="region"
      aria-label={`${stats.total} tool dijalankan: ${summaryLabel(stats)}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* ── Header — clickable accordion toggle ──────────── */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Sembunyikan detail tool' : 'Tampilkan detail tool'}
        className={`
          flex items-center gap-[11px] w-full px-[13px] py-[9px] rounded-lg mb-[7px]
          text-left transition-all duration-200
          group/header
          ${hasRunning
            ? 'bg-indigo-500/[0.08] border border-indigo-400/20'
            : isAllDone
              ? 'bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08]'
              : 'bg-red-500/[0.05] border border-red-500/15'
          }
        `}
      >
        {/* Icon */}
        <div className={`
          w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0
          ${hasRunning
            ? 'bg-indigo-500/20'
            : isAllDone
              ? 'bg-white/[0.04]'
              : 'bg-red-500/20'
          }
        `}>
          {hasRunning ? (
            <Clock size={14} className="text-indigo-300 animate-pulse" />
          ) : (
            <Wrench size={14} className={isAllDone ? 'text-white/40' : 'text-red-400'} />
          )}
        </div>

        {/* Label + summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-white/60">
              {stats.total} tool{stats.total > 1 ? 's' : ''} dijalankan
            </span>
            {/* Status dots */}
            <div className="flex items-center gap-1">
              {stats.done > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" title={`${stats.done} selesai`} />
              )}
              {stats.running > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" title={`${stats.running} berjalan`} />
              )}
              {stats.errors > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" title={`${stats.errors} gagal`} />
              )}
            </div>
          </div>
          <span className="text-[13px] text-white/30 font-mono">
            {summaryLabel(stats)}
          </span>
        </div>

        {/* Chevron */}
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-white/25 group-hover/header:text-white/40"
        >
          <ChevronRight size={15} />
        </motion.span>
      </button>

      {/* ── Expanded cards — vertical numbered list ─────── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <motion.div
              className="flex flex-col gap-[7px] pl-[5px]"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {toolCalls.map((tc, i) => (
                <ToolCallCard
                  key={`${tc.name}-${i}`}
                  {...tc}
                  step={i + 1}
                />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
