import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { Loader2, PanelLeftOpen, FolderOpen, Sun, Moon } from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import InputArea from './components/InputArea';
import WelcomeScreen from './components/WelcomeScreen';
import Sidebar from './components/Sidebar';

// ── Types ─────────────────────────────────────────────────────
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; preview?: string; args?: Record<string, unknown>; description?: string };
interface Message {
  role: 'user' | 'assistant';
  content: string;
  blocks?: Block[];
  timestamp: string;
}
interface FileNode { name: string; type: 'file' | 'dir'; children?: FileNode[]; }
interface ProjectInfo { totalFiles: number; techStack: string[]; skills: string[]; files?: FileNode[]; }
interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ── Tool metadata ─────────────────────────────────────────────
export const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  read_file: { icon: '📄', label: 'Baca file', color: '#60a5fa' },
  write_file: { icon: '✏️', label: 'Tulis file', color: '#34d399' },
  edit_file: { icon: '🔧', label: 'Edit file', color: '#fbbf24' },
  delete_file: { icon: '🗑️', label: 'Hapus file', color: '#f87171' },
  read_multiple_files: { icon: '📚', label: 'Baca beberapa file', color: '#60a5fa' },
  list_files: { icon: '🗂️', label: 'List file', color: '#a78bfa' },
  find_files: { icon: '🔍', label: 'Cari file', color: '#a78bfa' },
  search_in_files: { icon: '🔎', label: 'Cari dalam file', color: '#a78bfa' },
  run_command: { icon: '⚡', label: 'Jalankan command', color: '#fbbf24' },
  detect_tech_stack: { icon: '🧪', label: 'Deteksi tech stack', color: '#34d399' },
  find_ui_components: { icon: '🎨', label: 'Cari komponen UI', color: '#f472b6' },
  fetch_docs: { icon: '📚', label: 'Fetch docs', color: '#60a5fa' },
};

const FALLBACK_FILES: FileNode[] = [
  { name: 'src', type: 'dir', children: [
    { name: 'agent.js', type: 'file' }, { name: 'scanner.js', type: 'file' },
    { name: 'memory.js', type: 'file' }, { name: 'skills.js', type: 'file' },
    { name: 'tools.js', type: 'file' }, { name: 'prompts.js', type: 'file' },
  ]},
  { name: 'frontend', type: 'dir', children: [
    { name: 'src', type: 'dir', children: [
      { name: 'App.tsx', type: 'file' }, { name: 'main.tsx', type: 'file' },
    ]},
  ]},
  { name: 'skills', type: 'dir', children: [] },
  { name: 'memory', type: 'dir', children: [] },
  { name: 'index.js', type: 'file' },
  { name: 'server.js', type: 'file' },
  { name: 'package.json', type: 'file' },
];

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [_project, setProject] = useState<ProjectInfo>({
    totalFiles: 0, techStack: [], skills: [], files: FALLBACK_FILES,
  });
  const [_selectedPath] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [_historyLoaded, setHistoryLoaded] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const browseInputRef = useRef<HTMLInputElement>(null);
  const [browsePath, setBrowsePath] = useState<string>('');

  // ── Theme ─────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('flora-theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  // Sync theme ke <html> data-theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('flora-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // ── Browse state ──────────────────────────────────────────
  // Multi-path: array of chips, masing-masing bisa loading sendiri
  const [browseChips, setBrowseChips] = useState<{ path: string; loading?: boolean }[]>([]);

  // ── Load history from backend on mount ─────────────────────
  useEffect(() => {
    (async () => {
      try {
        // Load session list
        const sessRes = await axios.get(`${API_URL}/api/sessions`);
        setSessions(sessRes.data.sessions || []);
        setActiveSessionId(sessRes.data.activeId);

        // Load active session messages
        if (sessRes.data.activeId) {
          const memRes = await axios.get(`${API_URL}/api/memory`);
          const mem = memRes.data;
          if (mem.messages && mem.messages.length > 0) {
            // Convert backend messages to frontend Message format
            const restored: Message[] = mem.messages.map((m: any) => {
              // Restore blocks apa adanya — inline chips tetap tampil
              let blocks = m.blocks;
              if (!blocks || blocks.length === 0) {
                blocks = m.content ? [{ type: 'text', text: m.content }] : [];
              }
              // Bersihkan content dari marker inline selection mentah
              // Format: [TEKS YANG DIBLOK USER]\n<teks_diblok>\n\n[PERTANYAAN USER TENTANG TEKS DI ATAS]\n<pertanyaan>
              // Yang mau ditampilkan: <teks_diblok> + <pertanyaan> (tanpa marker)
              let cleanContent = m.content || '';
              if (cleanContent.includes('[TEKS YANG DIBLOK USER]')) {
                // Ambil teks yang diblok
                const blokMatch = cleanContent.match(/\[TEKS YANG DIBLOK USER\]\n([\s\S]*?)\n\n\[PERTANYAAN/);
                const blokText = blokMatch ? blokMatch[1].trim() : '';
                // Ambil pertanyaan user
                const qMatch = cleanContent.match(/\[PERTANYAAN USER TENTANG TEKS DI ATAS\]\n([\s\S]*)/);
                const qText = qMatch ? qMatch[1].trim() : '';
                // Gabung: teks blok + pertanyaan
                cleanContent = [blokText, qText].filter(Boolean).join('\n');
              }
              return {
                role: m.role,
                content: cleanContent,
                blocks,
                timestamp: m.timestamp
                  ? new Date(m.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                  : '',
              };
            });
            setMessages(restored);
          }
        }
      } catch {
        // Backend not ready or no history yet
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, []);

  // ── Scroll management ────────────────────────────────────
  // Rekam apakah user sengaja scroll ke atas (menolak auto-scroll)
  const userScrolledUpRef = useRef(false);

  // Deteksi scroll manual oleh user
  useEffect(() => {
    const container = bottomRef.current?.parentElement;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      // Kalau user scroll ke atas melebihi threshold, tandai sebagai "menyerah"
      if (distanceFromBottom > 150) {
        userScrolledUpRef.current = true;
      } else {
        userScrolledUpRef.current = false;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll ke bawah — menyerah kalau user sudah scroll ke atas
  const scrollToBottom = useCallback(() => {
    const el = bottomRef.current;
    if (!el) return;

    // Kalau user sengaja scroll ke atas, MENYERAH — jangan maksa
    if (userScrolledUpRef.current) return;

    const container = el.parentElement;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, []);

  // Auto-scroll saat ada token baru (streaming)
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Force scroll ke bawah saat loading mulai (user kirim pesan baru)
  useEffect(() => {
    if (loading) {
      // Reset flag user scroll — karena user baru kirim pesan, arahkan ke bawah
      userScrolledUpRef.current = false;
      const el = bottomRef.current;
      if (!el) return;
      const container = el.parentElement;
      if (!container) return;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [loading]);

  // Fetch project info on mount
  useEffect(() => {
    axios.get(`${API_URL}/api/project`)
      .then((r) => setProject({ ...r.data, files: r.data.files || FALLBACK_FILES }))
      .catch(() => {});
  }, []);

  // ── Refresh session list after each message exchange ─────
  const prevLoading = useRef(loading);
  useEffect(() => {
    // When loading transitions from true → false, refresh sessions
    if (prevLoading.current && !loading) {
      axios.get(`${API_URL}/api/sessions`)
        .then((r) => {
          setSessions(r.data.sessions || []);
          setActiveSessionId(r.data.activeId);
        })
        .catch(() => {});
    }
    prevLoading.current = loading;
  }, [loading]);

  // ── Inline Selection (dari desktop selection_watcher) ────
  // Polling backend setiap 1 detik untuk cek apakah ada teks baru
  // yang dikirim dari desktop selection_watcher
  useEffect(() => {
    const pollInline = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/inline-selection/pending`, {
          timeout: 3000,
        });
        const selections = res.data.selections || [];
        if (selections.length > 0) {
          // Tambah setiap selection sebagai chip
          for (const sel of selections) {
            const label = sel.text.length > 50
              ? sel.text.slice(0, 50) + '...'
              : sel.text;
            
            // Cek duplikat
            setBrowseChips((prev) => {
              const existing = new Set(prev.map((c) => c.path));
              if (existing.has(label)) return prev;
              return [...prev, { path: label, loading: false, _isInline: true, _fullText: sel.text }];
            });
          }
        }
      } catch {
        // Backend mungkin belum siap — skip
      }
    };

    // Polling tiap 1 detik
    const interval = setInterval(pollInline, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Inline Selection (dari ChatMessage — blok teks di UI FLORA) ──
  // Listen custom event 'flora-inline-selection' dari ChatMessage
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.text) return;

      const text = detail.text;
      const label = text.length > 50 ? text.slice(0, 50) + '...' : text;

      // Tambah sebagai chip badge di input
      setBrowseChips((prev) => {
        const existing = new Set(prev.map((c) => c.path));
        if (existing.has(label)) return prev;
        return [...prev, { path: label, loading: false, _isInline: true, _fullText: text }];
      });

      // Focus ke input
      setTimeout(() => {
        const textarea = document.querySelector('textarea');
        if (textarea) textarea.focus();
      }, 100);
    };

    document.addEventListener('flora-inline-selection', handler);
    return () => document.removeEventListener('flora-inline-selection', handler);
  }, []);

  // ── Browse modal state ──────────────────────────────────
  const [showBrowseModal, setShowBrowseModal] = useState(false);

  // ── Browse file/folder (multi-path: folder ATAU banyak file) ──
  const handleBrowse = () => {
    setShowBrowseModal(true);
  };

  const handleBrowseFolder = () => {
    setShowBrowseModal(false);
    browseInputRef.current?.click();
  };

  const handleBrowseFiles = () => {
    setShowBrowseModal(false);
    document.getElementById('browse-files-input')?.click();
  };

  const handleBrowseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Kumpulkan semua path unik
    const paths: string[] = [];
    const folderSet = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const relPath = (f as any).webkitRelativePath || f.name;
      // Kalau dari folder (webkitdirectory), ambil root folder-nya saja
      if ((f as any).webkitRelativePath) {
        const rootFolder = relPath.split('/')[0];
        if (!folderSet.has(rootFolder)) {
          folderSet.add(rootFolder);
          paths.push(rootFolder);
        }
      } else {
        // File individual — kirim path relatif dari project root
        // Kalau user pilih file dari luar project, kirim full path
        const fullPath = (f as any).path || f.name;
        // Coba dapatkan path relatif dari projectPath
        try {
          // Gunakan path relatif jika file ada di dalam project
          const projectRoot = (window as any).__PROJECT_PATH__ || '';
          if (projectRoot && fullPath.startsWith(projectRoot)) {
            paths.push(fullPath.slice(projectRoot.length + 1));
          } else {
            paths.push(fullPath);
          }
        } catch {
          paths.push(fullPath);
        }
      }
    }

    // Step 1: render chip dengan spinner dulu (loading=true)
    setBrowseChips((prev) => {
      const existing = new Set(prev.map((c) => c.path));
      const newPaths = paths.filter((p) => !existing.has(p));
      return [...prev, ...newPaths.map((p) => ({ path: p, loading: true }))];
    });
    setBrowsePath((prev) => {
      const all = prev ? prev.split(', ').filter(Boolean) : [];
      paths.forEach((p) => { if (!all.includes(p)) all.push(p); });
      return all.join(', ');
    });
    setInput('');

    // Step 2: flush React batch dulu dengan flushSync agar spinner sempat render
    // baru setelah itu hilangkan loading
    setTimeout(() => {
      setBrowseChips((prev) =>
        prev.map((c) => (paths.includes(c.path) ? { ...c, loading: false } : c))
      );
    }, 16); // 16ms = 1 frame (60fps), cukup 1 tick event loop
  };

  const handleClearBrowse = (idx?: number) => {
    if (idx === undefined || idx === -1) {
      // Hapus semua
      setBrowsePath('');
      setBrowseChips([]);
    } else {
      // Hapus satu chip — jangan reset input user!
      setBrowseChips((prev) => prev.filter((_, i) => i !== idx));
      setBrowsePath((prev) => {
        const all = prev.split(', ').filter(Boolean);
        all.splice(idx, 1);
        return all.join(', ');
      });
    }
  };

  // ── Refs untuk akses state terbaru tanpa stale closure ─────
  const inputRef = useRef(input);
  const browseChipsRef = useRef(browseChips);
  const browsePathRef = useRef(browsePath);
  const loadingRef = useRef(loading);

  // Sync refs setiap state berubah
  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { browseChipsRef.current = browseChips; }, [browseChips]);
  useEffect(() => { browsePathRef.current = browsePath; }, [browsePath]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // ── Send message with SSE streaming ───────────────────────
  const handleSend = useCallback(async (text?: string) => {
    // Pakai refs untuk hindari stale closure — selalu baca nilai TERBARU
    const currentInput = inputRef.current;
    const currentChips = browseChipsRef.current;
    const currentPath = browsePathRef.current;
    const isLoading = loadingRef.current;

    // Gabungkan input + browseChips sebagai konteks
    let query = (text ?? currentInput).trim();
    const hasChips = currentChips.length > 0;
    if (!query && !hasChips) return;

    // Siapkan payload dengan path rujukan
    const payload: any = { query: query || '' };
    if (currentPath) {
      payload.referencedPaths = currentPath.split(', ').filter(Boolean);
    }

    // Kalau ada inline selection chips, kirim teks aslinya sebagai konteks
    const inlineSelections = currentChips.filter(c => c._isInline && c._fullText);
    if (inlineSelections.length > 0) {
      const inlineTexts = inlineSelections.map(c => c._fullText).join('\n\n---\n\n');
      payload.inlineSelection = inlineTexts;
    }

    if (!query && hasChips) {
      const pathsList = currentChips.map((c) => c.path).join(', ');
      payload.query = `Cari dan baca konten dari path ini: ${pathsList}, lalu beri ringkasan atau jawab pertanyaan berikut:`;
    }
    if (!payload.query || isLoading) return;

    const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    // Add user message — sertakan inline selection chips sebagai blocks
    const displayText = text ?? currentInput;
    const chipLabels = currentChips.map((c) => c.path).join(', ');
    
    // Buat blocks untuk user message: text + inline chips
    const userBlocks: Block[] = [];
    if (displayText.trim()) {
      userBlocks.push({ type: 'text', text: displayText.trim() });
    }
    // Inline selection chips jadi badge di dalam bubble user
    const inlineChips = currentChips.filter(c => c._isInline && c._fullText);
    if (inlineChips.length > 0) {
      for (const chip of inlineChips) {
        userBlocks.push({ type: 'tool', name: 'inline', status: 'done', preview: chip._fullText, description: `Inline: ${chip.path}` });
      }
    }
    
    setMessages((p) => [...p, { 
      role: 'user', 
      content: displayText.trim() || `[inline] ${chipLabels}`, 
      blocks: userBlocks.length > 0 ? userBlocks : undefined,
      timestamp: ts 
    }]);
    setInput('');
    setBrowseChips([]);
    setBrowsePath('');
    setLoading(true);
    setSidebarOpen(false);

    // Add empty assistant message (will be filled via SSE)
    const assistantTs = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    setMessages((p) => [...p, { role: 'assistant', content: '', blocks: [], timestamp: assistantTs }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/analyze/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let parseGuard = 0;
      const MAX_PARSE_LOOPS = 1000; // safety: max 1000 event per chunk

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // ── SSE Parser yang benar ─────────────────────────────────
        // SSE spec: event dipisah oleh \n\n (double newline)
        // Tapi data JSON bisa mengandung \n — jadi kita harus parse
        // line-by-line, bukan split by \n\n
        parseGuard = 0;
        while (true) {
          parseGuard++;
          if (parseGuard > MAX_PARSE_LOOPS) {
            console.warn('⚠️ SSE parse loop exceeded max — clearing buffer');
            buffer = '';
            break;
          }

          // Cari double newline sebagai pemisah event
          const doubleNl = buffer.indexOf('\n\n');
          if (doubleNl === -1) break; // belum ada event lengkap

          const chunk = buffer.slice(0, doubleNl);
          buffer = buffer.slice(doubleNl + 2);

          // Parse event: and data: lines
          let eventType = '';
          let dataStr = '';
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('event: ')) eventType = trimmed.slice(7).trim();
            else if (trimmed.startsWith('data: ')) dataStr = trimmed.slice(6);
          }
          if (!eventType || !dataStr) continue;

          // Parse JSON data
          let payload: any;
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue; // skip malformed JSON
          }

          switch (eventType) {
            case 'tool_start': {
              const toolName: string = payload.name;
              const toolArgs: Record<string, unknown> | undefined = payload.args;
              const toolDesc: string = payload.description || '';
              setMessages((p) => {
                const msgs = [...p];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  const blocks = [...(last.blocks || [])];
                  blocks.push({ type: 'tool', name: toolName, status: 'running', args: toolArgs, description: toolDesc });
                  msgs[msgs.length - 1] = { ...last, blocks };
                }
                return msgs;
              });
              break;
            }

            case 'tool_end': {
              const toolName: string = payload.name;
              const preview: string = payload.preview || '';
              setMessages((p) => {
                const msgs = [...p];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  const blocks = [...(last.blocks || [])];
                  for (let i = blocks.length - 1; i >= 0; i--) {
                    const b = blocks[i];
                    if (b.type === 'tool' && b.name === toolName && b.status === 'running') {
                      blocks[i] = { ...b, status: 'done' as const, preview };
                      break;
                    }
                  }
                  msgs[msgs.length - 1] = { ...last, blocks };
                }
                return msgs;
              });
              break;
            }

            case 'token': {
              const token: string = payload.text;
              setMessages((p) => {
                const msgs = [...p];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  const blocks = [...(last.blocks || [])];
                  const lastBlock = blocks[blocks.length - 1];
                  if (lastBlock?.type === 'text') {
                    blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + token };
                  } else {
                    blocks.push({ type: 'text', text: token });
                  }
                  msgs[msgs.length - 1] = { ...last, blocks };
                }
                return msgs;
              });
              break;
            }

            case 'done':
              // Final text already accumulated via tokens
              // Pastiin loading mati — event done adalah sinyal bahwa stream selesai
              // Tapi jangan setLoading(false) langsung di sini karena masih di dalam
              // loop reader. Biar finally block yang handle.
              break;

            case 'error':
              setMessages((p) => {
                const msgs = [...p];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant' && (!last.blocks || last.blocks.length === 0)) {
                  msgs[msgs.length - 1] = { ...last, blocks: [{ type: 'text', text: `⚠️ Error: ${payload.message}` }] };
                }
                return msgs;
              });
              break;
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('SSE error:', err);
      setMessages((p) => {
        const msgs = [...p];
        const last = msgs[msgs.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          last.content = '⚠️ Gagal terhubung ke backend. Pastikan server berjalan.';
        }
        return msgs;
      });
    } finally {
      // 💾 Pastiin loading mati — pakai setTimeout biar React sempat batch
      // TAPI pastiin gak ada race condition: kalau ada error di stream,
      // loading harus tetap mati meski onDone gak pernah dipanggil
      setTimeout(() => {
        setLoading(false);
      }, 100); // kasih delay 100ms biar event 'done' sempat diproses dulu
    }
  }, []); // ⬅️ EMPTY array — semua state diakses via refs, jadi handleSend STABLE selamanya!

  // ── Stop generation ──────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ── Regenerate last response ──────────────────────────────
  const handleRegenerate = useCallback(() => {
    // Cari pesan user terakhir
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    // Hapus pesan asisten terakhir
    setMessages((p) => {
      const lastAssistantIdx = p.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'assistant')?.i;
      if (lastAssistantIdx !== undefined) {
        return p.slice(0, lastAssistantIdx);
      }
      return p;
    });

    // Kirim ulang query user
    handleSend(lastUserMsg.content);
  }, [messages, handleSend]);
  // ── Session management ──────────────────────────────────
  const handleSwitchSession = async (sessionId: string) => {
    try {
      const res = await axios.post(`${API_URL}/api/sessions/${sessionId}/activate`);
      const sess = res.data;
      setActiveSessionId(sess.id);
      // Restore messages — inline chips tetap tampil, bersihkan content mentah
      const restored: Message[] = (sess.messages || []).map((m: any) => {
        let blocks = m.blocks;
        if (!blocks || blocks.length === 0) {
          blocks = m.content ? [{ type: 'text', text: m.content }] : [];
        }
        // Bersihkan content dari marker inline selection mentah
        // Format: [TEKS YANG DIBLOK USER]\n<teks_diblok>\n\n[PERTANYAAN USER TENTANG TEKS DI ATAS]\n<pertanyaan>
        // Yang mau ditampilkan: <teks_diblok> + <pertanyaan> (tanpa marker)
        let cleanContent = m.content || '';
        if (cleanContent.includes('[TEKS YANG DIBLOK USER]')) {
          // Ambil teks yang diblok
          const blokMatch = cleanContent.match(/\[TEKS YANG DIBLOK USER\]\n([\s\S]*?)\n\n\[PERTANYAAN/);
          const blokText = blokMatch ? blokMatch[1].trim() : '';
          // Ambil pertanyaan user
          const qMatch = cleanContent.match(/\[PERTANYAAN USER TENTANG TEKS DI ATAS\]\n([\s\S]*)/);
          const qText = qMatch ? qMatch[1].trim() : '';
          // Gabung: teks blok + pertanyaan
          cleanContent = [blokText, qText].filter(Boolean).join('\n');
        }
        return {
          role: m.role,
          content: cleanContent,
          blocks,
          timestamp: m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '',
        };
      });
      setMessages(restored);
    } catch (err) {
      console.error('Gagal switch session:', err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await axios.delete(`${API_URL}/api/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (sessionId === activeSessionId) {
        // Load new active session or create new
        const sessRes = await axios.get(`${API_URL}/api/sessions`);
        setSessions(sessRes.data.sessions || []);
        if (sessRes.data.activeId) {
          handleSwitchSession(sessRes.data.activeId);
        } else {
          setMessages([]);
          setActiveSessionId(null);
        }
      }
    } catch (err) {
      console.error('Gagal hapus session:', err);
    }
  };
  // ── New chat ────────────────────────────────────────────
  const handleNewChat = async () => {
    try {
      const res = await axios.post(`${API_URL}/api/sessions`, { title: 'Chat baru' });
      const newSession = res.data;
      setActiveSessionId(newSession.id);
      setSessions((prev) => [{
        id: newSession.id,
        title: newSession.title,
        createdAt: newSession.createdAt,
        updatedAt: newSession.updatedAt,
        messageCount: 0,
      }, ...prev]);
    } catch {
      console.warn('Gagal buat session baru, lanjut offline');
    }
    setMessages([]);
    setInput('');
    setSidebarOpen(false);
  };

  return (
    <>
      <div className="flex h-screen relative">
        {/* Sidebar */}
        <Sidebar
          open={sidebarOpen}
          collapsed={sidebarCollapsed}
          onClose={() => setSidebarOpen(false)}
          onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
          onNewChat={handleNewChat}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={handleDeleteSession}
        />

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden items-center relative">

          {/* Floating button — mobile: buka sidebar */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Buka sidebar"
            className="lg:hidden fixed top-4 left-4 z-30 p-2 rounded-xl
                       transition-all duration-200"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }}
          >
            <PanelLeftOpen size={18} />
          </button>

          {/* Floating button — desktop: expand collapsed sidebar */}
          <button
            onClick={() => setSidebarCollapsed(false)}
            aria-label="Lebarkan sidebar"
            className={`hidden lg:flex fixed top-4 left-[68px] z-30 p-2 rounded-xl
                       transition-all duration-300
                       ${sidebarCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }}
          >
            <PanelLeftOpen size={16} />
          </button>

          {/* Theme toggle — pojok kanan atas */}
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
            className="fixed top-4 right-4 z-30 p-2 rounded-xl
                       transition-all duration-200"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.background = 'var(--bg-tertiary)';
            }}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-[22px] py-[26px] flex flex-col gap-[26px] items-center w-full max-w-[900px]"
            style={{ overflowAnchor: 'none', scrollBehavior: loading ? 'auto' : 'smooth' }}
          >
            <div className="w-full flex flex-col gap-6">
              {messages.length === 0 ? (
                <WelcomeScreen onSuggestion={handleSend} />
              ) : (
                messages.map((msg, i) => (
                  <ChatMessage
                    key={i}
                    message={msg}
                    onRegenerate={i === messages.length - 1 && msg.role === 'assistant' ? handleRegenerate : undefined}
                    isStreaming={loading && i === messages.length - 1 && msg.role === 'assistant'}
                  />
                ))
              )}

              {/* Typing indicator — hanya saat agent berpikir (sebelum ada output) */}
              <AnimatePresence>
                {loading && (() => {
                  const lastMsg = messages[messages.length - 1];
                  const hasOutput = lastMsg?.role === 'assistant' && lastMsg.blocks && lastMsg.blocks.length > 0;
                  if (hasOutput) return null; // sudah ada output, pakai streaming cursor + tool cards

                  return (
                    <motion.div
                      className="flex gap-3 items-start"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0"
                           style={{ background: 'var(--bg-tertiary)' }}>
                        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-primary)' }} />
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-md"
                           style={{ background: 'var(--bg-secondary)' }}>
                        <span className="text-[14px]" style={{ color: 'var(--text-primary)' }}>Agent sedang berpikir</span>
                        <span className="flex gap-1">
                          {[0, 150, 300].map((d) => (
                            <span
                              key={d}
                              className="w-1 h-1 rounded-full"
                              style={{ background: '#6b6b6b', animation: `dots 1.2s ease-in-out ${d}ms infinite` }}
                            />
                          ))}
                        </span>
                      </div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </div>

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="w-full max-w-[850px] px-[22px]">
            {/* Hidden file input — bisa pilih folder (webkitdirectory) ATAU banyak file (multiple) */}
            {/* Dua input: satu untuk folder (webkitdirectory), satu untuk file individual */}
            <input
              ref={browseInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is valid
              webkitdirectory=""
              className="hidden"
              onChange={handleBrowseFile}
              aria-label="Browse folder"
            />
            <input
              type="file"
              multiple
              className="hidden"
              id="browse-files-input"
              onChange={handleBrowseFile}
              aria-label="Browse file"
            />

            <InputArea
              value={input}
              onChange={setInput}
              onSend={() => handleSend()}
              onStop={handleStop}
              loading={loading}
              browsePath={browsePath}
              browseChips={browseChips}
              onBrowse={handleBrowse}
              onClearBrowse={handleClearBrowse}
            />
          </div>
        </main>
      </div>

      {/* ── Browse Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showBrowseModal && (
          <>
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50"
              style={{ background: 'rgba(0,0,0,0.5)' }}
              onClick={() => setShowBrowseModal(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                         w-[320px] rounded-2xl overflow-hidden"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              {/* Header */}
              <div className="px-5 pt-5 pb-3">
                <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Rujuk file atau folder
                </h3>
                <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Pilih sumber yang ingin dirujuk ke agent
                </p>
              </div>

              {/* Divider */}
              <div className="mx-5 h-px" style={{ background: 'var(--border-subtle)' }} />

              {/* Options */}
              <div className="px-5 py-4 space-y-2">
                <button
                  onClick={handleBrowseFolder}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl
                             transition-all duration-150 text-left"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                  }}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ background: 'var(--accent-soft)' }}>
                    <FolderOpen size={18} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium">Folder project</span>
                    <span className="block text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Rujuk semua file dalam satu folder
                    </span>
                  </div>
                </button>

                <button
                  onClick={handleBrowseFiles}
                  className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl
                             transition-all duration-150 text-left"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                  }}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ background: 'var(--accent-soft)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <line x1="10" y1="9" x2="8" y2="9" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium">File individual</span>
                    <span className="block text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Pilih satu atau beberapa file spesifik
                    </span>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div className="px-5 pb-4 pt-1">
                <button
                  onClick={() => setShowBrowseModal(false)}
                  className="w-full py-2.5 rounded-xl text-[13px] font-medium
                             transition-all duration-150"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                >
                  Batal
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
