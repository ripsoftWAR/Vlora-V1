import { Send, Loader2, Square } from 'lucide-react';
import { useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
}

export default function InputArea({ value, onChange, onSend, onStop, loading }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  };

  const canSend = value.trim() && !loading;

  return (
    <div className="px-6 pb-6 pt-3 border-t border-white/[0.05] bg-white/[0.01] backdrop-blur-xl">
      <div
        className="flex items-end gap-2.5 bg-white/[0.04] border border-white/[0.08]
                   rounded-2xl px-4 py-3 backdrop-blur-2xl
                   transition-all duration-300
                   focus-within:border-indigo-400/40 focus-within:shadow-[0_0_0_4px_rgba(99,102,241,0.06)]"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
          }}
          onKeyDown={handleKeyDown}
          placeholder="Tanya tentang project kamu..."
          aria-label="Ketik pertanyaan tentang project"
          disabled={loading}
          className="flex-1 bg-transparent border-none resize-none text-[14px]
                     text-slate-200 placeholder-white/30 leading-relaxed
                     max-h-[130px] outline-none
                     disabled:opacity-40 disabled:cursor-not-allowed"
        />

        {/* Stop button — muncul saat loading */}
        {loading && (
          <button
            onClick={onStop}
            aria-label="Hentikan generasi"
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                       bg-red-500/15 border border-red-400/30 text-red-400
                       hover:bg-red-500/25 hover:scale-105 active:scale-95
                       transition-all duration-200 cursor-pointer
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          >
            <Square size={12} fill="currentColor" />
          </button>
        )}

        <button
          onClick={onSend}
          disabled={!canSend}
          aria-label={loading ? 'Mengirim...' : 'Kirim pesan'}
          className={`
            w-9 h-9 rounded-xl flex items-center justify-center
            flex-shrink-0 transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50
            ${canSend
              ? 'bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30 hover:scale-105 hover:shadow-indigo-500/40 active:scale-95 cursor-pointer'
              : 'bg-white/[0.04] text-white/15 cursor-not-allowed'
            }
          `}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>

      <p className="text-[10px] font-mono text-white/20 text-center mt-2.5">
        Ctrl+Enter kirim · /scan /memory /tree /help
      </p>
    </div>
  );
}
