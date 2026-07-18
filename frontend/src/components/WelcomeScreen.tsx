import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Code, Search, Bug, FileCode, Wrench } from 'lucide-react';

interface Props {
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  'Jelaskan arsitektur project ini',
  'Review kode agent.js',
  'Cari potensi bug di project ini',
  'Bagaimana cara menambah tool baru?',
];

const CAPABILITIES = [
  { icon: Code, label: 'Baca & analisis kode', desc: 'Pahami struktur, logika, dan dependensi' },
  { icon: Search, label: 'Cari di seluruh project', desc: 'Temukan file, fungsi, atau pola tertentu' },
  { icon: Bug, label: 'Debug & optimasi', desc: 'Deteksi bug, bottleneck, dan security issue' },
  { icon: FileCode, label: 'Edit & tulis kode', desc: 'Buat komponen, refactor, tambah fitur' },
  { icon: Wrench, label: 'Tool desktop', desc: 'Word, Excel, PowerPoint, Blender, FreeCAD' },
];

const TYPING_TEXT = 'Ada yang perlu saya bantu?';

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.6,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 400, damping: 26 },
  },
};

export default function WelcomeScreen({ onSuggestion }: Props) {
  const [displayed, setDisplayed] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const [typingDone, setTypingDone] = useState(false);

  // ── Typing animation ──────────────────────────────────────
  useEffect(() => {
    if (displayed.length < TYPING_TEXT.length) {
      const timeout = setTimeout(() => {
        setDisplayed(TYPING_TEXT.slice(0, displayed.length + 1));
      }, 45);
      return () => clearTimeout(timeout);
    } else {
      setTypingDone(true);
    }
  }, [displayed]);

  // ── Blinking cursor ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <main
      className="flex-1 flex flex-col items-center justify-center gap-[32px] p-[44px] max-w-[560px] mx-auto w-full"
      role="banner"
    >
      {/* Heading — typing animation */}
      <motion.div
        className="text-center space-y-[13px]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <h1 className="text-[24px] font-medium tracking-tight min-h-[32px]"
            style={{ color: 'var(--text-primary)' }}>
          {displayed}
          <span
            className={`inline-block w-[2px] h-[22px] ml-[2px] align-middle transition-opacity duration-100 ${
              showCursor ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ background: 'var(--text-primary)' }}
          />
        </h1>

        <motion.p
          className="text-[17px] leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: typingDone ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          Agent AI yang bisa baca, analisis, dan edit kode project-mu secara realtime.
          Juga bisa bantu di Word, Excel, PowerPoint, Blender, dan FreeCAD.
        </motion.p>
      </motion.div>

      {/* Capabilities — muncul setelah typing selesai */}
      {typingDone && (
        <motion.div
          className="grid grid-cols-5 gap-[8px] w-full"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
        >
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.label}
              className="flex flex-col items-center gap-[6px] px-[8px] py-[10px] rounded-lg
                         transition-all duration-200 group"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.borderColor = 'var(--border-default)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <div className="w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-colors"
                   style={{ background: 'var(--bg-tertiary)' }}>
                <cap.icon size={13} style={{ color: 'var(--text-primary)' }} />
              </div>
              <span className="text-[11px] text-center leading-tight transition-colors"
                    style={{ color: 'var(--text-primary)' }}>
                {cap.label}
              </span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Suggestions — staggered entry */}
      <motion.div
        className="grid grid-cols-2 gap-[11px] w-full"
        role="list"
        aria-label="Contoh pertanyaan"
        variants={containerVariants}
        initial="hidden"
        animate={typingDone ? 'visible' : 'hidden'}
      >
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s}
            onClick={() => onSuggestion(s)}
            aria-label={`Tanyakan: ${s}`}
            variants={itemVariants}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            className="group flex items-center gap-[9px] px-[15px] py-[13px] rounded-lg
                       text-left text-[15px]
                       transition-all duration-150
                       focus-visible:outline-none focus-visible:ring-1"
            style={{
              color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <span className="flex-1 leading-snug">{s}</span>
            <ArrowRight
              size={14}
              aria-hidden="true"
              className="group-hover:translate-x-0.5 transition-all"
              style={{ color: 'var(--text-primary)' }}
            />
          </motion.button>
        ))}
      </motion.div>
    </main>
  );
}
