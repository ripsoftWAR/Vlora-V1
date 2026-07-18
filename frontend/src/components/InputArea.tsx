import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Square, FolderOpen, X } from 'lucide-react';

interface Chip {
  path: string;
  loading?: boolean;
  _isInline?: boolean;
  _fullText?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  loading: boolean;
  browsePath?: string;
  browseChips?: Chip[];
  onBrowse?: () => void;
  onClearBrowse?: (idx?: number) => void;
}

export default function InputArea({ value, onChange, onSend, onStop, loading, browseChips, onBrowse, onClearBrowse }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  // Reset tinggi textarea saat value dikosongkan dari luar (setelah kirim)
  useEffect(() => {
    if (!value && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  };

  const canSend = (hasText || (browseChips && browseChips.length > 0)) && !loading;

  return (
    <div className="pb-[18px] pt-[9px]">
      {/* Browse chips — multi-path, tiap folder/file punya chip sendiri */}
      <AnimatePresence>
        {browseChips && browseChips.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="w-full mb-[5px] flex flex-wrap gap-[6px]"
          >
            {browseChips.map((chip, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.12, delay: idx * 0.03 }}
                className="inline-flex items-center gap-[6px] px-[10px] py-[4px] rounded-lg group/chip relative"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                {chip.loading ? (
                  <Loader2 size={11} style={{ color: 'var(--text-primary)' }} className="animate-spin flex-shrink-0" />
                ) : chip._isInline ? (
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-primary)' }}>in</span>
                ) : (
                  <FolderOpen size={11} style={{ color: 'var(--text-primary)' }} className="flex-shrink-0" />
                )}
                <span className="text-[12px] truncate max-w-[200px]" style={{ color: 'var(--text-primary)' }}>
                  {chip.path}
                </span>
                {/* Tooltip kustom — muncul di hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[6px] px-[10px] py-[4px] rounded-lg
                             text-[12px] whitespace-nowrap pointer-events-none z-50
                             opacity-0 group-hover/chip:opacity-100 transition-opacity duration-150"
                     style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
                  {chip._fullText || chip.path}
                </div>
                <button
                  onClick={() => onClearBrowse?.(idx)}
                  className="p-[1px] rounded transition-colors flex-shrink-0"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  aria-label={`Hapus rujukan ${chip.path}`}
                >
                  <X size={10} />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="flex items-end gap-[11px] rounded-2xl px-[12px] py-[10px]
                   transition-all duration-300"
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-default)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-strong)';
          e.currentTarget.style.background = 'var(--bg-secondary)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-default)';
          e.currentTarget.style.background = 'var(--bg-input)';
        }}
      >
        {/* Browse button — navigasi/rujukan file/folder */}
        <button
          onClick={onBrowse}
          disabled={loading}
          aria-label="Rujuk folder atau file"
          title="Rujuk folder atau file — pilih beberapa sekaligus"
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                     transition-all duration-200
                     disabled:opacity-30 disabled:cursor-not-allowed
                     focus-visible:outline-none focus-visible:ring-1
                     group relative"
          style={{
            color: 'var(--text-primary)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            '--tw-ring-color': 'var(--border-strong)',
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
        >
          <FolderOpen size={16} />
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md
                           text-[11px] whitespace-nowrap
                           opacity-0 group-hover:opacity-100 transition-opacity duration-200
                           pointer-events-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            Rujuk file/folder
          </span>
        </button>

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
          placeholder={''}
          className="flex-1 bg-transparent border-none resize-none text-[17px]
                     leading-relaxed max-h-[143px] outline-none
                     disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: 'var(--text-primary)' }}
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
                       transition-colors duration-200 cursor-pointer
                       focus-visible:outline-none focus-visible:ring-1"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
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
          className="w-10 h-10 rounded-xl flex items-center justify-center
                     flex-shrink-0 transition-all duration-200
                     focus-visible:outline-none focus-visible:ring-1"
          style={{
            background: canSend ? 'var(--bg-tertiary)' : 'transparent',
            color: canSend ? 'var(--text-primary)' : '#6b6b6b',
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={(e) => {
            if (canSend) {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (canSend) {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={17} />
          )}
        </motion.button>
      </div>

      <p className="text-[13px] font-mono text-center mt-[6px]"
         style={{ color: 'var(--text-primary)' }}>
        Ctrl+Enter kirim · /scan /memory /tree /help
      </p>
    </div>
  );
}
