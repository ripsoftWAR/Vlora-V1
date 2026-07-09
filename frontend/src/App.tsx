import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { Menu, Loader2 } from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import InputArea from './components/InputArea';
import WelcomeScreen from './components/WelcomeScreen';
import Sidebar from './components/Sidebar';

// ── Types ─────────────────────────────────────────────────────
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; preview?: string; args?: Record<string, unknown> };
interface Message {
  role: 'user' | 'assistant';
  content: string;
  blocks?: Block[];
  timestamp: string;
}
interface FileNode { name: string; type: 'file' | 'dir'; children?: FileNode[]; }
interface ProjectInfo { totalFiles: number; techStack: string[]; skills: string[]; files?: FileNode[]; }

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
  const [project, setProject] = useState<ProjectInfo>({
    totalFiles: 0, techStack: [], skills: [], files: FALLBACK_FILES,
  });
  const [selectedPath, setSelectedPath] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: loading ? 'auto' : 'smooth',
        block: 'end',
      });
    }
  }, [messages, loading]);

  // Fetch project info on mount
  useEffect(() => {
    axios.get(`${API_URL}/api/project`)
      .then((r) => setProject({ ...r.data, files: r.data.files || FALLBACK_FILES }))
      .catch(() => {});
  }, []);

  // ── Folder upload ─────────────────────────────────────────
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach((f) => {
      if (f.webkitRelativePath.includes('node_modules/')) return;
      if (f.webkitRelativePath.includes('.git/')) return;
      formData.append('files', f, f.webkitRelativePath);
    });

    try {
      const res = await axios.post(`${API_URL}/api/upload-folder`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProject({ ...res.data, files: res.data.files || FALLBACK_FILES });
      setSelectedPath(res.data.projectPath || 'project');
    } catch {
      console.error('Upload gagal');
    }
  };

  // ── Send message with SSE streaming ───────────────────────
  const handleSend = useCallback(async (text?: string) => {
    const query = (text ?? input).trim();
    if (!query || loading) return;

    const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    // Add user message
    setMessages((p) => [...p, { role: 'user', content: query, timestamp: ts }]);
    setInput('');
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
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (separated by double newline)
        while (buffer.includes('\n\n')) {
          const idx = buffer.indexOf('\n\n');
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          // Parse event: and data: lines
          let eventType = '';
          let dataStr = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          if (!eventType || !dataStr) continue;

          try {
            const payload = JSON.parse(dataStr);

            switch (eventType) {
              case 'tool_start': {
                const toolName: string = payload.name;
                const toolArgs: Record<string, unknown> | undefined = payload.args;
                setMessages((p) => {
                  const msgs = [...p];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === 'assistant') {
                    const blocks = [...(last.blocks || [])];
                    blocks.push({ type: 'tool', name: toolName, status: 'running', args: toolArgs });
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
          } catch {
            // Skip malformed JSON
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
      setLoading(false);
    }
  }, [input, loading]);

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
  const handleNewChat = () => {
    if (messages.length === 0) return;
    const confirmed = window.confirm(
      '⚡ Yakin ingin memulai chat baru? Percakapan saat ini akan hilang.'
    );
    if (!confirmed) return;
    setMessages([]);
    setInput('');
    setSidebarOpen(false);
  };

  return (
    <>
      {/* Ambient background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[600px] h-[600px] rounded-full
                      bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,transparent_70%)] blur-3xl" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[700px] h-[700px] rounded-full
                      bg-[radial-gradient(circle,rgba(59,130,246,0.10)_0%,transparent_70%)] blur-3xl" />
        <div className="absolute top-[40%] left-[40%] w-[400px] h-[400px] rounded-full
                      bg-[radial-gradient(circle,rgba(139,92,246,0.06)_0%,transparent_70%)] blur-[80px]" />
      </div>

      <div className="flex h-screen relative z-[1]">
        {/* Sidebar */}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          project={project}
          selectedPath={selectedPath}
          onFolderUpload={handleFolderUpload}
          onNewChat={handleNewChat}
        />

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.05]
                        bg-white/[0.01] backdrop-blur-xl min-h-[49px]">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka sidebar"
              className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-white/30
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:rounded-lg"
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <span className="text-[12px] font-medium text-white/30">
              {messages.length === 0 ? 'Sesi baru' : 'Percakapan aktif'}
            </span>
            <div className="ml-auto" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6">
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
                    <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08]
                                  flex items-center justify-center flex-shrink-0">
                      <Loader2 size={14} className="text-indigo-300 animate-spin" />
                    </div>
                    <div className="flex items-center gap-2 px-4 py-3 rounded-2xl rounded-tl-md
                                  bg-white/[0.04] border border-white/[0.07] backdrop-blur-xl">
                      <span className="text-[13px] text-white/50">Agent sedang berpikir</span>
                      <span className="flex gap-1">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="w-1 h-1 rounded-full bg-indigo-300/40"
                            style={{ animation: `dots 1.2s ease-in-out ${d}ms infinite` }}
                          />
                        ))}
                      </span>
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <InputArea
            value={input}
            onChange={setInput}
            onSend={() => handleSend()}
            onStop={handleStop}
            loading={loading}
          />
        </main>
      </div>
    </>
  );
}
