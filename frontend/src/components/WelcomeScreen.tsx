import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

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
      className="flex-1 flex flex-col items-center justify-center gap-[35px] p-[44px] max-w-[528px] mx-auto w-full"
      role="banner"
    >
      {/* Heading */}
      <motion.div
        className="text-center space-y-[13px]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
      >
        <h1 className="text-[24px] font-medium text-white/85 tracking-tight">
          Ada yang perlu saya bantu?
        </h1>
        <p className="text-[17px] text-white/35 leading-relaxed">
          Agent akan membaca kode, memori, dan skills aktif
          untuk menjawab pertanyaanmu secara realtime.
        </p>
      </motion.div>

      {/* Suggestions — staggered entry */}
      <motion.div
        className="grid grid-cols-2 gap-[11px] w-full"
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
            className="group flex items-center gap-[9px] px-[15px] py-[13px] rounded-lg
                       text-left text-[15px] text-white/40
                       bg-white/[0.02] border border-white/[0.04]
                       hover:bg-white/[0.04] hover:border-white/[0.07]
                       hover:text-white/55
                       transition-all duration-150
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
          >
            <span className="flex-1 leading-snug">{s}</span>
            <ArrowRight
              size={14}
              aria-hidden="true"
              className="text-white/15 group-hover:text-white/25 group-hover:translate-x-0.5 transition-all"
            />
          </motion.button>
        ))}
      </motion.div>
    </main>
  );
}
