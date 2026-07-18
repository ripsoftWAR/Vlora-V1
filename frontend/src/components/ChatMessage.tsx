import { useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check, RefreshCw } from 'lucide-react';
import ToolCallCard from './ToolCallCard';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; preview?: string; args?: Record<string, unknown>; description?: string };

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
    <div className="relative group/code my-[9px]">
      <div className="flex items-center justify-between px-[13px] py-[7px] rounded-t-md"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderBottom: 'none',
        }}>
        <span className="text-[12px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-tertiary)' }}>
          {lang || 'code'}
        </span>
        <motion.button
          onClick={handleCopy}
          aria-label={copied ? 'Tersalin' : 'Salin kode'}
          className="flex items-center gap-[7px] px-[9px] py-[2px] rounded
                     text-[12px] transition-colors duration-200
                     focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          style={{ color: 'var(--text-secondary)' }}
          whileTap={{ scale: 0.92 }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-500" />
              <span className="text-emerald-500">Tersalin</span>
            </>
          ) : (
            <>
              <Copy size={13} />
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
        flex gap-[13px] items-start
        ${isUser ? 'flex-row-reverse self-end ml-auto max-w-[75%]' : 'self-start w-full'}
      `}
    >
      {/* Avatar */}
      <motion.div
        role="img"
        aria-label={isUser ? 'Avatar pengguna' : 'Avatar asisten AI'}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.08 }}
        style={{
          background: isUser ? 'var(--bg-tertiary)' : 'var(--bg-tertiary)',
        }}
      >
        {isUser ? (
          <User size={14} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
        ) : (
          <Bot size={14} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
        )}
      </motion.div>

      {/* Content */}
      <div className={`
        min-w-0
        ${isUser ? 'max-w-full' : 'max-w-[75%] flex-1'}
      `}>
        {/* Interleaved blocks — text & tool cards berseling */}
        {isUser ? (
          <div className="rounded-[15px_15px_4px_15px] px-[18px] py-[11px] text-[17px] leading-[1.75] w-fit max-w-full"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : hasBlocks ? (
          <div className="flex flex-col gap-[7px]">
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
                  description={block.description}
                  step={bi + 1}
                />
              ) : (
                <div
                  key={bi}
                  className={`text-[17px] leading-[1.78] md-content ${isLastTextBlock ? 'streaming-cursor' : ''}`}
                  style={{ color: 'var(--text-primary)' }}
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
        <div className={`flex items-center gap-[9px] mt-[7px] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <p className="text-[13px] font-mono" style={{ color: '#6b6b6b' }}>
            {message.timestamp}
          </p>

          {/* Actions — always visible, ultra subtle */}
          {!isUser && allText.trim().length > 0 && (
            <div className="flex items-center gap-[2px]">
              {/* Copy */}
              <button
                onClick={handleCopyMessage}
                aria-label={copied ? 'Tersalin' : 'Salin pesan'}
                className="p-[5px] rounded transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              >
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              </button>

              {/* Regenerate */}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  aria-label="Regenerasi jawaban"
                  className="p-[5px] rounded transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                >
                  <RefreshCw size={13} />
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
