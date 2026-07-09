import { motion } from 'framer-motion';
import { MessageSquare, ArrowRight } from 'lucide-react';

interface Props {
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  'Jelaskan arsitektur project ini',
  'Review kode agent.js',
  'Cari potensi bug di project ini',
  'Bagaimana cara menambah tool baru?',
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
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
  return (
    <main
      className="flex-1 flex flex-col items-center justify-center gap-8 p-10 max-w-[460px] mx-auto w-full"
      role="banner"
    >
      {/* Logo */}
      <motion.div
        className="relative"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.05 }}
      >
        <div className="relative w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
          <MessageSquare size={22} className="text-white/50" aria-hidden="true" />
        </div>
      </motion.div>

      {/* Heading */}
      <motion.div
        className="text-center space-y-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        <h1 className="text-[17px] font-medium text-white/85 tracking-tight">
          Tanya tentang project kamu
        </h1>
        <p className="text-[13px] text-white/40 leading-relaxed">
          Agent akan membaca kode, memori, dan skills aktif
          untuk menjawab pertanyaanmu secara realtime.
        </p>
      </motion.div>

      {/* Suggestions — staggered entry */}
      <motion.div
        className="grid grid-cols-2 gap-2.5 w-full"
        role="list"
        aria-label="Contoh pertanyaan"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s}
            onClick={() => onSuggestion(s)}
            aria-label={`Tanyakan: ${s}`}
            variants={itemVariants}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            className="group flex items-center gap-2 px-3.5 py-3 rounded-lg
                       text-left text-[13px] text-white/50
                       bg-white/[0.03] border border-white/[0.06]
                       hover:bg-white/[0.05] hover:border-white/[0.10]
                       hover:text-white/70
                       transition-all duration-150
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
          >
            <span className="flex-1 leading-snug">{s}</span>
            <ArrowRight
              size={13}
              aria-hidden="true"
              className="text-white/20 group-hover:text-white/35 group-hover:translate-x-0.5 transition-all"
            />
          </motion.button>
        ))}
      </motion.div>
    </main>
  );
}
