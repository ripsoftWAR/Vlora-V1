import { useState } from 'react';
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

export default function ToolCallGroup({ toolCalls }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls.length) return null;

  const visible = expanded ? toolCalls : toolCalls.slice(0, 3);
  const hidden = toolCalls.length - 3;

  return (
    <div className="mb-2 animate-in fade-in slide-in-from-left-2 duration-300"
         role="region" aria-label={`${toolCalls.length} tool dijalankan`}>
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-px h-3 bg-indigo-400/40 rounded-full" aria-hidden="true" />
        <span className="text-[10px] font-mono text-white/25 tracking-widest uppercase">
          {toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((t, i) => (
          <ToolCallCard key={i} {...t} />
        ))}
        {!expanded && hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            aria-label={`Tampilkan ${hidden} tool lainnya`}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg
                       text-[11px] text-white/25 font-mono
                       bg-white/[0.03] border border-white/[0.06]
                       hover:bg-white/[0.06] hover:text-white/40
                       transition-all duration-200
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
          >
            +{hidden} lagi
            <ChevronRight size={10} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
