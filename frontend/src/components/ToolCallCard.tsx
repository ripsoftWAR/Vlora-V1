import { motion } from 'framer-motion';
import { Check, Loader2, X } from 'lucide-react';
import { TOOL_META } from '../App';

interface Props {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
}

const cardVariants = {
  hidden: { opacity: 0, x: -10, scale: 0.94 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 500, damping: 28 },
  },
};

export default function ToolCallCard({ name, status, preview }: Props) {
  const config = TOOL_META[name] || { icon: '⚙️', label: name, color: '#9ca3af' };
  const isDone = status === 'done';
  const isRunning = status === 'running';

  const statusLabel = isRunning ? 'sedang berjalan' : isDone ? 'selesai' : 'gagal';

  return (
    <motion.div
      role="status"
      aria-label={`Tool ${config.label}: ${statusLabel}${preview && isDone ? ` — ${preview}` : ''}`}
      variants={cardVariants}
      layout
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
        text-xs font-medium font-mono
        transition-colors duration-300 ease-out
        ${isDone
          ? 'bg-white/[0.03] border border-white/[0.06] text-white/45'
          : isRunning
            ? 'bg-white/[0.06] border border-white/[0.12] shadow-[0_0_12px_rgba(99,102,241,0.12)]'
            : 'bg-red-500/[0.06] border border-red-500/20 text-red-400'
        }
      `}
    >
      {/* Status indicator */}
      {isRunning ? (
        <Loader2 size={12} className="animate-spin" style={{ color: config.color }} aria-hidden="true" />
      ) : isDone ? (
        <Check size={12} style={{ color: config.color }} aria-hidden="true" />
      ) : (
        <X size={12} className="text-red-400" aria-hidden="true" />
      )}

      {/* Icon emoji */}
      <span className="text-xs" aria-hidden="true">{config.icon}</span>

      {/* Label */}
      <span style={{ color: isDone ? config.color : undefined }}>
        {config.label}
      </span>

      {/* Preview on done */}
      {preview && isDone && (
        <span className="text-xs text-white/40 truncate max-w-[100px]">
          · {preview}
        </span>
      )}
    </motion.div>
  );
}
