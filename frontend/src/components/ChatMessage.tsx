import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check, RefreshCw } from 'lucide-react';
import ToolCallGroup from './ToolCallGroup';

interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
  args?: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
}

interface Props {
  message: Message;
  onRegenerate?: () => void;
}

// ── CodeBlock dengan copy button ───────────────────────────────
function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, '');
  const lang = className?.replace('language-', '') || '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="relative group/code my-2">
      <div className="flex items-center justify-between px-3 py-1.5
                    bg-white/[0.06] border border-white/[0.06] border-b-0
                    rounded-t-lg">
        <span className="text-xs font-mono text-white/40 uppercase tracking-wider">
          {lang || 'code'}
        </span>
        <motion.button
          onClick={handleCopy}
          aria-label={copied ? 'Tersalin' : 'Salin kode'}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md
                     text-xs text-white/40 hover:text-white/55
                     hover:bg-white/[0.06] transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
          whileTap={{ scale: 0.92 }}
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Tersalin</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Salin</span>
            </>
          )}
        </motion.button>
      </div>
      <pre className="!mt-0 !rounded-t-none !rounded-b-lg">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// ── Phase Divider ──────────────────────────────────────────────
function PhaseDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-2" role="separator">
      <div className="flex-1 h-px bg-white/[0.05]" />
      <span className="text-[10px] font-mono text-white/25 uppercase tracking-widest flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-white/[0.05]" />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function ChatMessage({ message, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const hasToolCalls = !isUser && message.toolCalls && message.toolCalls.length > 0;
  const hasContent = message.content.trim().length > 0;

  const handleCopyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }, [message.content]);

  return (
    <motion.div
      role="article"
      aria-label={isUser ? 'Pesan pengguna' : 'Pesan asisten'}
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      }}
      className={`
        flex gap-3 items-start max-w-[780px] w-full px-3 py-2.5 rounded-xl
        hover:bg-white/[0.02] transition-colors duration-150
        group/msg
        ${isUser ? 'flex-row-reverse self-end' : 'self-start'}
      `}
    >
      {/* Avatar */}
      <motion.div
        role="img"
        aria-label={isUser ? 'Avatar pengguna' : 'Avatar asisten AI'}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.08 }}
        className={`
          w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0
          ${isUser
            ? 'bg-indigo-500/80'
            : 'bg-white/[0.04] border border-white/[0.07]'
          }
        `}
      >
        {isUser ? (
          <User size={14} className="text-white" aria-hidden="true" />
        ) : (
          <Bot size={14} className="text-indigo-300" aria-hidden="true" />
        )}
      </motion.div>

      {/* Content */}
      <div className="max-w-[calc(100%-44px)] min-w-0 flex-1">
        {/* Tool calls before bubble */}
        {hasToolCalls && (
          <ToolCallGroup toolCalls={message.toolCalls!} />
        )}

        {/* Phase divider — muncul antara tools dan konten teks */}
        {hasToolCalls && hasContent && (
          <PhaseDivider label="Respons" />
        )}

        {/* Bubble */}
        {hasContent && (
          <div
            className={`
              relative px-4 py-3 rounded-2xl text-[14.5px] leading-[1.75]
              ${isUser
                ? 'bg-white/[0.07] border border-white/[0.10] text-white/90 rounded-[14px_14px_4px_14px]'
                : 'text-white/80 border-l-2 border-l-indigo-400/25 pl-4'
              }
            `}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="md-content">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const isInline = !className;
                      if (isInline) {
                        return <code className={className} {...props}>{children}</code>;
                      }
                      return <CodeBlock className={className}>{children}</CodeBlock>;
                    },
                    table({ children }) {
                      return (
                        <div className="table-wrapper">
                          <table>{children}</table>
                        </div>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Timestamp + Message Actions */}
        <div className={`flex items-center gap-2 mt-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <p className="text-xs font-mono text-white/40">
            {message.timestamp}
          </p>

          {/* Actions — hover reveal (assistant only) */}
          {!isUser && hasContent && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
              {/* Copy */}
              <button
                onClick={handleCopyMessage}
                aria-label={copied ? 'Tersalin' : 'Salin pesan'}
                className="p-1 rounded hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>

              {/* Regenerate */}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  aria-label="Regenerasi jawaban"
                  className="p-1 rounded hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
