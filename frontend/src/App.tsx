import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: string[];
  timestamp: string;
}

interface FileNode {
  name: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface ProjectInfo {
  totalFiles: number;
  techStack: string[];
  skills: string[];
  files?: FileNode[];
}

type AgentStatus = 'idle' | 'scanning' | 'thinking' | 'coding' | 'searching';

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string }> = {
  idle: { label: '', color: '' },
  scanning: { label: 'Memindai project', color: '#16a34a' },
  thinking: { label: 'Berpikir', color: '#7c3aed' },
  coding: { label: 'Membuat analisis', color: '#2563eb' },
  searching: { label: 'Mencari konteks', color: '#d97706' },
};

const SUGGESTED = [
  'Jelaskan arsitektur project ini',
  'Review kode agent.js',
  'Cari potensi bug di project ini',
  'Bagaimana cara menambah tool baru?',
];

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === 'idle') return null;
  const { label, color } = STATUS_CONFIG[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: color,
        animation: 'blink 1.4s ease-in-out infinite', flexShrink: 0,
      }} />
      {label}
    </span>
  );
}

function FileTree({ nodes, depth = 0 }: { nodes: FileNode[]; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <>
      {nodes.map(n => (
        <div key={n.name}>
          <div
            onClick={() => n.type === 'dir' && setOpen(p => ({ ...p, [n.name]: !p[n.name] }))}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              paddingLeft: depth * 12 + 4, paddingTop: 3, paddingBottom: 3,
              fontSize: 12, color: n.type === 'dir' ? '#374151' : '#6b7280',
              cursor: n.type === 'dir' ? 'pointer' : 'default',
              borderRadius: 5,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 11, width: 14, textAlign: 'center', opacity: 0.6 }}>
              {n.type === 'dir' ? (open[n.name] ? '▾' : '▸') : '·'}
            </span>
            <span style={{ fontFamily: n.type === 'file' ? 'var(--font-mono, monospace)' : 'inherit', fontSize: n.type === 'file' ? 11 : 12 }}>
              {n.name}
            </span>
          </div>
          {n.type === 'dir' && open[n.name] && n.children && (
            <FileTree nodes={n.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  );
}

const FALLBACK_FILES: FileNode[] = [
  {
    name: 'src', type: 'dir', children: [
      { name: 'agent.js', type: 'file' },
      { name: 'scanner.js', type: 'file' },
      { name: 'memory.js', type: 'file' },
      { name: 'skills.js', type: 'file' },
      { name: 'tools.js', type: 'file' },
      { name: 'prompts.js', type: 'file' },
      { name: 'colors.js', type: 'file' },
    ]
  },
  {
    name: 'frontend', type: 'dir', children: [
      {
        name: 'src', type: 'dir', children: [
          { name: 'App.tsx', type: 'file' },
          { name: 'main.tsx', type: 'file' },
        ]
      },
    ]
  },
  { name: 'skills', type: 'dir', children: [] },
  { name: 'memory', type: 'dir', children: [] },
  { name: 'index.js', type: 'file' },
  { name: 'server.js', type: 'file' },
  { name: 'package.json', type: 'file' },
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [project, setProject] = useState<ProjectInfo>({ totalFiles: 0, techStack: [], skills: [], files: FALLBACK_FILES });
  const [selectedPath, setSelectedPath] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    axios.get('http://localhost:5000/api/project')
      .then(r => setProject({ ...r.data, files: r.data.files || FALLBACK_FILES }))
      .catch(() => { });
  }, []);

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f, f.webkitRelativePath));

    setStatus('scanning');
    try {
      const res = await axios.post('http://localhost:5000/api/upload-folder', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setProject({ ...res.data, files: res.data.files || FALLBACK_FILES });
      setSelectedPath(res.data.projectPath || 'project');
    } catch {
      console.error('Upload gagal');
    } finally {
      setStatus('idle');
    }
  };

  const handleSend = async (text?: string) => {
    const query = (text ?? input).trim();
    if (!query || loading) return;

    const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    setMessages(p => [...p, { role: 'user', content: query, timestamp: ts }]);
    setInput('');
    setLoading(true);

    setStatus('scanning'); await delay(450);
    setStatus('thinking'); await delay(550);
    setStatus('searching'); await delay(380);
    setStatus('coding');

    try {
      const res = await axios.post('http://localhost:5000/api/analyze', { query });
      const { text: reply, toolCalls } = res.data;
      const ts2 = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      setMessages(p => [...p, { role: 'assistant', content: reply, toolCalls: toolCalls || [], timestamp: ts2 }]);
    } catch {
      const ts2 = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      setMessages(p => [...p, {
        role: 'assistant',
        content: 'Gagal konek ke backend. Pastikan `node server.js` sudah berjalan.',
        timestamp: ts2,
      }]);
    } finally {
      setStatus('idle');
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const techStack = project.techStack?.length ? project.techStack : ['Node.js', 'React', 'Vite', 'TypeScript', 'Express'];

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; -webkit-font-smoothing: antialiased; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes dots { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 99px; }
        .md p { margin-bottom: 10px; line-height: 1.75; }
.md h1,.md h2,.md h3 { font-weight: 600; margin: 14px 0 6px; color: #111827; }
.md h3 { font-size: 13.5px; }
.md ul,.md ol { padding-left: 18px; margin-bottom: 10px; }
.md li { margin-bottom: 4px; font-size: 13.5px; line-height: 1.7; }
.md code { font-family: monospace; font-size: 12px; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.md pre { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin-bottom: 10px; }
.md pre code { background: none; padding: 0; font-size: 12px; }
.md table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 12.5px; }
.md th { background: #f3f4f6; padding: 6px 10px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600; }
.md td { padding: 6px 10px; border: 1px solid #e5e7eb; }
.md strong { font-weight: 600; }
.md blockquote { border-left: 3px solid #e5e7eb; padding-left: 12px; color: #6b7280; margin-bottom: 10px; }
      `}</style>

      <div style={{ display: 'flex', height: '100vh', background: '#f9fafb' }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: 252, flexShrink: 0,
          background: '#ffffff',
          borderRight: '1px solid #f3f4f6',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Brand */}
          <div style={{ padding: '20px 18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: -0.5,
              }}>A</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', letterSpacing: -0.3 }}>Analyst Agent</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>llama-3.3-70b · online</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
            {/* Project */}
            <div style={{ padding: '0 18px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#d1d5db', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Project</div>
              {/* Folder Picker Button */}
              <input
                ref={fileInputRef}
                type="file"
                webkitdirectory=""
                multiple
                style={{ display: 'none' }}
                onChange={handleFolderUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: '8px 10px', marginBottom: 10,
                  background: '#eff6ff', border: '1px solid #bfdbfe',
                  borderRadius: 8, fontSize: 12, fontWeight: 500, color: '#1d4ed8',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span>📂</span> Pilih Folder Project
              </button>

              {selectedPath && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>📁</span>
                  <span style={{
                    fontSize: 12, fontWeight: 500, color: '#374151',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {selectedPath}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>📁</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>project-analyst-agent</span>
              </div>
              {project.totalFiles > 0 && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, paddingLeft: 19 }}>
                  {project.totalFiles} file terdeteksi
                </div>
              )}
              <div style={{ paddingLeft: 4 }}>
                <FileTree nodes={project.files || FALLBACK_FILES} />
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0 12px' }} />

            {/* Tech stack */}
            <div style={{ padding: '0 18px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#d1d5db', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Tech stack</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {techStack.map(t => (
                  <span key={t} style={{
                    fontSize: 11, fontWeight: 500,
                    background: '#f3f4f6', border: '1px solid #e5e7eb',
                    borderRadius: 5, padding: '2px 7px', color: '#4b5563',
                  }}>{t}</span>
                ))}
              </div>
            </div>

            {/* Skills */}
            {project.skills?.length > 0 && (
              <>
                <div style={{ height: 1, background: '#f3f4f6', margin: '4px 0 12px' }} />
                <div style={{ padding: '0 18px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#d1d5db', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Skills aktif</div>
                  {project.skills.map(s => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#4b5563', padding: '3px 0' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, display: 'inline-block' }} />
                      {s}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* New chat */}
          <div style={{ padding: '12px 18px', borderTop: '1px solid #f3f4f6' }}>
            <button
              onClick={() => { setMessages([]); setInput(''); textareaRef.current?.focus(); }}
              style={{
                width: '100%', padding: '8px 12px',
                background: '#f9fafb', border: '1px solid #e5e7eb',
                borderRadius: 8, fontSize: 12, fontWeight: 500, color: '#6b7280',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb'; }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Chat baru
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#ffffff' }}>

          {/* Topbar */}
          <div style={{
            padding: '13px 28px', borderBottom: '1px solid #f3f4f6',
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 52,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
              {messages.length === 0 ? 'Sesi baru' : 'Percakapan aktif'}
            </span>
            <div style={{ marginLeft: 'auto' }}>
              <StatusDot status={status} />
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '32px 28px', display: 'flex', flexDirection: 'column', gap: 28 }}>
            {messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '40px 20px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: '#eff6ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22,
                }}>💬</div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 6 }}>Tanya tentang project kamu</p>
                  <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6 }}>Agent akan membaca kode, memori, dan skills yang aktif untuk menjawab pertanyaanmu.</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                  {SUGGESTED.map(s => (
                    <button
                      key={s}
                      onClick={() => handleSend(s)}
                      style={{
                        padding: '10px 12px', textAlign: 'left',
                        background: '#f9fafb', border: '1px solid #e5e7eb',
                        borderRadius: 10, fontSize: 12, color: '#374151',
                        cursor: 'pointer', lineHeight: 1.5,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb'; }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row', maxWidth: 780, width: '100%', alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: isUser ? '#1d4ed8' : '#eff6ff',
                      color: isUser ? '#fff' : '#1d4ed8',
                    }}>
                      {isUser ? 'K' : 'AI'}
                    </div>
                    <div style={{ maxWidth: 'calc(100% - 42px)' }}>
                      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                          {msg.toolCalls.map((t, j) => (
                            <span key={j} style={{
                              fontSize: 11, fontFamily: 'monospace',
                              color: '#6b7280', background: '#f9fafb',
                              border: '1px solid #e5e7eb', borderRadius: 5,
                              padding: '2px 8px',
                            }}>⚙ {t}</span>
                          ))}
                        </div>
                      )}
                      <div style={{
                        padding: '11px 15px',
                        borderRadius: 14,
                        borderTopLeftRadius: isUser ? 14 : 3,
                        borderTopRightRadius: isUser ? 3 : 14,
                        fontSize: 13.5, lineHeight: 1.75,
                        background: isUser ? '#1d4ed8' : '#f9fafb',
                        color: isUser ? '#ffffff' : '#111827',
                        border: isUser ? 'none' : '1px solid #f3f4f6',
                      }}>
                        {isUser ? msg.content : (
                          <div className="md">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {loading && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8',
                }}>AI</div>
                <div style={{
                  padding: '14px 16px', borderRadius: 14, borderTopLeftRadius: 3,
                  background: '#f9fafb', border: '1px solid #f3f4f6',
                  display: 'flex', gap: 5, alignItems: 'center',
                }}>
                  {[0, 150, 300].map(d => (
                    <span key={d} style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#9ca3af',
                      display: 'inline-block',
                      animation: `dots 1.2s ease-in-out ${d}ms infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '16px 28px 24px', borderTop: '1px solid #f3f4f6', background: '#ffffff' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              background: '#f9fafb', border: '1.5px solid #e5e7eb',
              borderRadius: 14, padding: '12px 14px',
              transition: 'border-color 0.15s',
            }}
              onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#3b82f6'; }}
              onBlurCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb'; }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px';
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
                }}
                placeholder="Tanya tentang project kamu..."
                style={{
                  flex: 1, background: 'transparent', border: 'none', resize: 'none',
                  fontSize: 13.5, color: '#111827', lineHeight: 1.6,
                  maxHeight: 130, overflow: 'auto', outline: 'none',
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                style={{
                  width: 32, height: 32, borderRadius: 9, border: 'none',
                  background: loading || !input.trim() ? '#e5e7eb' : '#1d4ed8',
                  color: loading || !input.trim() ? '#9ca3af' : '#fff',
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0, transition: 'all 0.15s',
                }}
                aria-label="Kirim"
              >↑</button>
            </div>
            <p style={{ fontSize: 11, color: '#d1d5db', textAlign: 'center', marginTop: 9 }}>
              Ctrl+Enter untuk kirim · /scan /memory /tree /help
            </p>
          </div>
        </main>
      </div>
    </>
  );
}