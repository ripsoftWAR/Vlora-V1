import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check } from 'lucide-react';
import ToolCallGroup from './ToolCallGroup';

interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  preview?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
}

interface Props {
  message: Message;
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
      // fallback
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
      {/* Lang badge + copy button */}
      <div className="flex items-center justify-between px-3 py-1.5
                    bg-white/[0.06] border border-white/[0.06] border-b-0
                    rounded-t-lg">
        <span className="text-[10px] font-mono text-white/25 uppercase tracking-wider">
          {lang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          aria-label={copied ? 'Tersalin' : 'Salin kode'}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md
                     text-[11px] text-white/25 hover:text-white/50
                     hover:bg-white/[0.06] transition-all duration-200
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Tersalin</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Salin</span>
            </>
          )}
        </button>
      </div>
      {/* Code */}
      <pre className="!mt-0 !rounded-t-none !rounded-b-lg">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div
      role="article"
      aria-label={isUser ? 'Pesan pengguna' : 'Pesan asisten'}
      className={`
        flex gap-3 items-start max-w-[780px] w-full
        animate-in fade-in slide-in-from-bottom-1 duration-300
        ${isUser ? 'flex-row-reverse self-end' : 'self-start'}
      `}
    >
      {/* Avatar */}
      <div
        role="img"
        aria-label={isUser ? 'Avatar pengguna' : 'Avatar asisten AI'}
        className={`
          w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0
          transition-all duration-300
          ${isUser
            ? 'bg-gradient-to-br from-indigo-500 to-blue-500 shadow-lg shadow-indigo-500/25'
            : 'bg-white/[0.06] border border-white/[0.08]'
          }
        `}
      >
        {isUser ? (
          <User size={14} className="text-white" aria-hidden="true" />
        ) : (
          <Bot size={14} className="text-indigo-300" aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <div className="max-w-[calc(100%-44px)] min-w-0">
        {/* Tool calls before bubble */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallGroup toolCalls={message.toolCalls} />
        )}

        {/* Bubble */}
        <div
          className={`
            px-4 py-3 rounded-2xl text-[14.5px] leading-[1.75]
            transition-all duration-300
            ${isUser
              ? 'bg-gradient-to-br from-indigo-500/50 to-blue-500/40 border border-indigo-400/30 text-white shadow-lg shadow-indigo-500/10 rounded-tr-md backdrop-blur-xl'
              : 'bg-white/[0.04] border border-white/[0.07] text-slate-200 rounded-tl-md backdrop-blur-xl'
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

        {/* Timestamp */}
        <p className={`text-[10px] font-mono text-white/25 mt-1.5 ${isUser ? 'text-right' : 'text-left'}`}>
          {message.timestamp}
        </p>
      </div>
    </div>
  );
}
