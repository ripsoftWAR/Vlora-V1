import { useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check, RefreshCw } from 'lucide-react';
import ToolCallCard from './ToolCallCard';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; preview?: string; args?: Record<string, unknown> };

interface Message {
  role: 'user' | 'assistant';
  content: string;
  blocks?: Block[];
  timestamp: string;
}

interface Props {
  message: Message;
  onRegenerate?: () => void;
  isStreaming?: boolean;
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

// ── Main Component ────────────────────────────────────────────
const ChatMessage = memo(function ChatMessage({ message, onRegenerate, isStreaming = false }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const blocks = !isUser ? (message.blocks || []) : [];
  const hasBlocks = blocks.length > 0;

  // Gabung semua text blocks untuk copy
  const allText = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');

  const handleCopyMessage = useCallback(async () => {
    const textToCopy = isUser ? message.content : allText;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }, [isUser, message.content, allText]);

  return (
    <motion.div
      role="article"
      aria-label={isUser ? 'Pesan pengguna' : 'Pesan asisten'}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`
        flex gap-3 items-start max-w-[720px] px-3 py-2.5 rounded-xl
        ${isUser ? 'flex-row-reverse self-end w-fit ml-auto' : 'self-start w-full'}
      `}
      style={{ willChange: 'auto' }}
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
      <div className={`
        max-w-[calc(100%-44px)] min-w-0
        ${isUser ? '' : 'flex-1'}
      `}>
        {/* Interleaved blocks — text & tool cards berseling */}
        {isUser ? (
          <div className="bg-white/[0.07] border border-white/[0.10] text-white/90 rounded-[14px_14px_4px_14px] px-4 py-2.5 text-[14.5px] leading-[1.75] w-fit max-w-full">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : hasBlocks ? (
          <div className="border-l-2 border-white/[0.06] pl-3 flex flex-col gap-1.5">
            {blocks.map((block, bi) => {
              const isLastBlock = bi === blocks.length - 1;
              const isLastTextBlock = block.type === 'text' && isLastBlock && isStreaming;

              return block.type === 'tool' ? (
                <ToolCallCard
                  key={`${block.name}-${bi}`}
                  name={block.name}
                  status={block.status}
                  preview={block.preview}
                  args={block.args}
                  step={bi + 1}
                />
              ) : (
                <div
                  key={bi}
                  className={`text-white/80 text-[14.5px] leading-[1.75] md-content ${isLastTextBlock ? 'streaming-cursor' : ''}`}
                >
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
                    {block.text}
                  </ReactMarkdown>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Timestamp + Message Actions */}
        <div className={`flex items-center gap-2 mt-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <p className="text-xs font-mono text-white/40">
            {message.timestamp}
          </p>

          {/* Actions — always visible, ultra subtle */}
          {!isUser && allText.trim().length > 0 && (
            <div className="flex items-center gap-0.5">
              {/* Copy */}
              <button
                onClick={handleCopyMessage}
                aria-label={copied ? 'Tersalin' : 'Salin pesan'}
                className="p-1 rounded hover:bg-white/[0.06] text-white/20 hover:text-white/45 transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>

              {/* Regenerate */}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  aria-label="Regenerasi jawaban"
                  className="p-1 rounded hover:bg-white/[0.06] text-white/20 hover:text-white/45 transition-colors"
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
});

export default ChatMessage;
