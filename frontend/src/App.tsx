import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Menu, Loader2 } from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import InputArea from './components/InputArea';
import WelcomeScreen from './components/WelcomeScreen';
import Sidebar from './components/Sidebar';
import RealtimeBadge from './components/RealtimeBadge';

// ── Types ─────────────────────────────────────────────────────
interface ToolCall { name: string; status: 'running' | 'done' | 'error'; preview?: string; }
interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
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
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [project, setProject] = useState<ProjectInfo>({
    totalFiles: 0, techStack: [], skills: [], files: FALLBACK_FILES,
  });
  const [selectedPath, setSelectedPath] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    setMessages((p) => [...p, { role: 'assistant', content: '', toolCalls: [], timestamp: assistantTs }]);

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
                setActiveTool(toolName);
                setMessages((p) => {
                  const msgs = [...p];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === 'assistant') {
                    const tcs = last.toolCalls || [];
                    // Replace existing running entry for same tool, or add new
                    const idx = tcs.findIndex(t => t.name === toolName && t.status === 'running');
                    if (idx >= 0) {
                      tcs[idx] = { ...tcs[idx], status: 'running' };
                    } else {
                      tcs.push({ name: toolName, status: 'running', preview: '' });
                    }
                    last.toolCalls = [...tcs];
                  }
                  return msgs;
                });
                break;
              }

              case 'tool_end': {
                const toolName: string = payload.name;
                const preview: string = payload.preview || '';
                setActiveTool(null);
                setMessages((p) => {
                  const msgs = [...p];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === 'assistant') {
                    const tcs = (last.toolCalls || []).map(t =>
                      t.name === toolName && t.status === 'running'
                        ? { ...t, status: 'done' as const, preview }
                        : t
                    );
                    last.toolCalls = tcs;
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
                    last.content += token;
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
                  if (last?.role === 'assistant' && !last.content) {
                    last.content = `⚠️ Error: ${payload.message}`;
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
      setActiveTool(null);
    }
  }, [input, loading]);

  // ── Stop generation ──────────────────────────────────────
  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ── New chat (dengan konfirmasi) ──────────────────────────
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

      {/* Realtime badge */}
      <RealtimeBadge toolName={activeTool} />

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
                <ChatMessage key={i} message={msg} />
              ))
            )}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-3 items-start animate-in fade-in duration-200">
                <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08]
                              flex items-center justify-center flex-shrink-0">
                  <Loader2 size={14} className="text-indigo-300 animate-spin" />
                </div>
                <div className="flex gap-1.5 px-4 py-3 rounded-2xl rounded-tl-md
                              bg-white/[0.04] border border-white/[0.07] backdrop-blur-xl">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-indigo-300/50"
                      style={{ animation: `dots 1.2s ease-in-out ${d}ms infinite` }}
                    />
                  ))}
                </div>
              </div>
            )}

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
