import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Square, CornerDownLeft } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
}

export default function InputArea({ value, onChange, onSend, onStop, loading }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

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

  const canSend = hasText && !loading;

  return (
    <div className="pb-[18px] pt-[9px]">
      {/* Keyboard hint — muncul saat user mulai mengetik */}
      <AnimatePresence>
        {hasText && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="flex justify-end mb-[7px]"
          >
            <span className="inline-flex items-center gap-[5px] px-[9px] py-[2px] rounded-md
                           text-[12px] text-white/20 font-mono">
              <CornerDownLeft size={11} aria-hidden="true" />
              Enter
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="flex items-end gap-[11px] bg-white/[0.04] border border-white/[0.06]
                   rounded-2xl px-[16px] py-[10px]
                   transition-all duration-300
                   focus-within:border-white/[0.12] focus-within:bg-white/[0.05]"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 143) + 'px';
          }}
          onKeyDown={handleKeyDown}
          aria-label="Ketik pertanyaan tentang project"
          disabled={loading}
          className="flex-1 bg-transparent border-none resize-none text-[17px]
                     text-white/80 placeholder-white/25 leading-relaxed
                     max-h-[143px] outline-none
                     disabled:opacity-40 disabled:cursor-not-allowed"
        />

        {/* Stop button — muncul saat loading */}
        {loading && (
          <motion.button
            onClick={onStop}
            aria-label="Hentikan generasi"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                       bg-white/[0.06] text-white/50
                       hover:bg-white/[0.10] hover:text-white/70
                       transition-colors duration-200 cursor-pointer
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            <Square size={13} fill="currentColor" />
          </motion.button>
        )}

        <motion.button
          onClick={onSend}
          disabled={!canSend}
          aria-label={loading ? 'Mengirim...' : 'Kirim pesan'}
          whileHover={canSend ? { scale: 1.08 } : {}}
          whileTap={canSend ? { scale: 0.9 } : {}}
          className={`
            w-10 h-10 rounded-xl flex items-center justify-center
            flex-shrink-0 transition-all duration-200
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20
            ${canSend
              ? 'bg-white/[0.10] text-white/80 hover:bg-white/[0.15] cursor-pointer'
              : 'bg-transparent text-white/10 cursor-not-allowed'
            }
          `}
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={17} />
          )}
        </motion.button>
      </div>

      <p className="text-[13px] font-mono text-white/20 text-center mt-[6px]">
        Ctrl+Enter kirim · /scan /memory /tree /help
      </p>
    </div>
  );
}
