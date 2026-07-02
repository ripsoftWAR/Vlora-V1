import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import ToolCallCard from './ToolCallCard';

interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
}

interface Props {
  toolCalls: ToolCall[];
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

export default function ToolCallGroup({ toolCalls }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls.length) return null;

  const visible = expanded ? toolCalls : toolCalls.slice(0, 3);
  const hidden = toolCalls.length - 3;

  return (
    <motion.div
      className="mb-2"
      role="region"
      aria-label={`${toolCalls.length} tool dijalankan`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-px h-3 bg-indigo-400/40 rounded-full" aria-hidden="true" />
        <span className="text-xs font-mono text-white/40 tracking-widest uppercase">
          {toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Cards — staggered */}
      <motion.div
        className="flex flex-wrap gap-2"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {visible.map((t, i) => (
          <ToolCallCard key={i} {...t} />
        ))}
        {!expanded && hidden > 0 && (
          <motion.button
            onClick={() => setExpanded(true)}
            aria-label={`Tampilkan ${hidden} tool lainnya`}
            variants={{
              hidden: { opacity: 0, x: -6 },
              visible: { opacity: 1, x: 0 },
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg
                       text-xs text-white/40 font-mono
                       bg-white/[0.03] border border-white/[0.06]
                       hover:bg-white/[0.06] hover:text-white/55
                       transition-colors duration-200
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
          >
            +{hidden} lagi
            <ChevronRight size={12} aria-hidden="true" />
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  );
}
