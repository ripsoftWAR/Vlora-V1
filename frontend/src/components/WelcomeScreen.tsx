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

export default function WelcomeScreen({ onSuggestion }: Props) {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-8 p-10 max-w-[460px] mx-auto w-full" role="banner">
      {/* Logo */}
      <div className="relative">
        <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-indigo-500/20 blur-2xl" aria-hidden="true" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-blue-500/20
                      border border-indigo-400/20 flex items-center justify-center
                      shadow-[0_0_40px_rgba(99,102,241,0.15)]">
          <MessageSquare size={26} className="text-indigo-300" aria-hidden="true" />
        </div>
      </div>

      {/* Heading */}
      <div className="text-center space-y-3">
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">
          Tanya tentang project kamu
        </h1>
        <p className="text-[13px] text-white/40 leading-relaxed">
          Agent akan membaca kode, memori, dan skills aktif
          untuk menjawab pertanyaanmu secara realtime.
        </p>
      </div>

      {/* Suggestions */}
      <div className="grid grid-cols-2 gap-2.5 w-full" role="list" aria-label="Contoh pertanyaan">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            aria-label={`Tanyakan: ${s}`}
            className="group flex items-center gap-2 px-3.5 py-3 rounded-xl
                       text-left text-[12.5px] text-white/45
                       bg-white/[0.03] border border-white/[0.06]
                       hover:bg-white/[0.06] hover:border-white/[0.12]
                       hover:text-white/70
                       transition-all duration-200
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
          >
            <span className="flex-1 leading-snug">{s}</span>
            <ArrowRight
              size={13}
              aria-hidden="true"
              className="text-white/10 group-hover:text-white/30 group-hover:translate-x-0.5 transition-all"
            />
          </button>
        ))}
      </div>
    </main>
  );
}
