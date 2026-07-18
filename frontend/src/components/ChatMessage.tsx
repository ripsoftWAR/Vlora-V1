import { useState, useCallback, memo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check, RefreshCw, ArrowUp, Paperclip, Send } from 'lucide-react';
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

// ── Inline Selection Toolbar ────────────────────────────────────
function InlineSelectionToolbar({ selectedText, onAskFlora, position }: {
  selectedText: string;
  onAskFlora: (text: string) => void;
  position: { x: number; y: number } | null;
}) {
  if (!position) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -4 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="fixed z-[9999] pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <button
        onClick={() => onAskFlora(selectedText)}
        className="flex items-center gap-[6px] px-[10px] py-[5px] rounded-lg
                   text-[13px] font-medium shadow-lg
                   transition-all duration-150"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-secondary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
      >
        <ArrowUp size={14} />
        <span>Tanya FLORA</span>
      </button>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────
const ChatMessage = memo(function ChatMessage({ message, onRegenerate, isStreaming = false }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const blocks = !isUser ? (message.blocks || []) : [];
  const hasBlocks = blocks.length > 0;

  // ── Inline Selection State ──────────────────────────────────
  const [selectedText, setSelectedText] = useState('');
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Handler: user selesai blok teks (mouseup)
  const handleSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setSelectedText('');
      setToolbarPos(null);
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 2 || text.length > 2000) {
      setToolbarPos(null);
      return;
    }

    // Cek apakah selection ada di dalam komponen ini
    const container = contentRef.current;
    if (!container) return;

    let isInside = false;
    const range = selection.getRangeAt(0);
    let node: Node | null = range.commonAncestorContainer;
    while (node) {
      if (node === container) {
        isInside = true;
        break;
      }
      node = node.parentNode;
    }

    if (!isInside) {
      setToolbarPos(null);
      return;
    }

    // Hitung posisi toolbar — di atas selection
    const rect = range.getBoundingClientRect();
    setSelectedText(text);
    setToolbarPos({
      x: rect.left + rect.width / 2 - 60, // center toolbar (120px wide / 2)
      y: rect.top - 40, // di atas selection
    });
  }, []);

  // Handler: user klik di luar → hide toolbar
  const handleClickOutside = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.inline-selection-toolbar')) return;
    setSelectedText('');
    setToolbarPos(null);
  }, []);

  // Register global listeners
  useEffect(() => {
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleSelection, handleClickOutside]);

  // Callback: kirim teks yang diblok ke parent (App.tsx)
  const handleAskFlora = useCallback((text: string) => {
    // Dispatch custom event — App.tsx akan listen
    const event = new CustomEvent('flora-inline-selection', {
      detail: { text },
      bubbles: true,
    });
    document.dispatchEvent(event);
    setSelectedText('');
    setToolbarPos(null);
  }, []);

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
          <div className="flex flex-col gap-[7px] max-w-full">
            {/* User message content */}
            <div className="rounded-[15px_15px_4px_15px] px-[18px] py-[11px] text-[17px] leading-[1.75] w-fit max-w-full"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
              }}>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
            {/* Inline selection chips — render sebagai badge di dalam bubble user */}
            {message.blocks && message.blocks.length > 0 && (
              <div className="flex flex-wrap gap-[5px] pl-[4px]">
                {message.blocks.map((block, bi) => {
                  if (block.type === 'tool' && block.name === '📎 inline') {
                    return (
                      <div
                        key={bi}
                        className="inline-flex items-center gap-[5px] px-[8px] py-[3px] rounded-lg text-[12px]"
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                        title={block.preview}
                      >
                        <Paperclip size={10} />
                        <span className="truncate max-w-[180px]">{block.description?.replace('Inline: ', '')}</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        ) : hasBlocks ? (
          <div className="flex flex-col gap-[7px]" ref={contentRef}>
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

            {/* Inline Selection Toolbar — muncul saat user blok teks */}
            <AnimatePresence>
              {selectedText && toolbarPos && (
                <InlineSelectionToolbar
                  selectedText={selectedText}
                  onAskFlora={handleAskFlora}
                  position={toolbarPos}
                />
              )}
            </AnimatePresence>
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
