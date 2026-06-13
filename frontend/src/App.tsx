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
  scanning: { label: 'Memindai project', color: '#34d399' },
  thinking: { label: 'Berpikir', color: '#a78bfa' },
  coding: { label: 'Membuat analisis', color: '#60a5fa' },
  searching: { label: 'Mencari konteks', color: '#fbbf24' },
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
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: 12, color,
      background: `${color}18`,
      border: `1px solid ${color}30`,
      borderRadius: 99, padding: '3px 10px 3px 7px',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        animation: 'blink 1.4s ease-in-out infinite', flexShrink: 0,
        boxShadow: `0 0 6px ${color}`,
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
              fontSize: 11.5,
              color: n.type === 'dir' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)',
              cursor: n.type === 'dir' ? 'pointer' : 'default',
              borderRadius: 5,
              userSelect: 'none',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.color = 'rgba(255,255,255,0.9)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.color =
                n.type === 'dir' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)';
            }}
          >
            <span style={{ fontSize: 10, width: 14, textAlign: 'center', opacity: 0.5 }}>
              {n.type === 'dir' ? (open[n.name] ? '▾' : '▸') : '·'}
            </span>
            <span style={{
              fontFamily: n.type === 'file' ? "'JetBrains Mono', monospace" : 'inherit',
              fontSize: n.type === 'file' ? 10.5 : 11.5,
            }}>
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
  const [project, setProject] = useState<ProjectInfo>({
    totalFiles: 0, techStack: [], skills: [], files: FALLBACK_FILES,
  });
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    axios.get('http://localhost:5000/api/project')
      .then((r: { data: ProjectInfo & { files?: FileNode[] } }) =>
        setProject({ ...r.data, files: r.data.files || FALLBACK_FILES })
      )
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
        headers: { 'Content-Type': 'multipart/form-data' },
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
    setSidebarOpen(false);

    setStatus('scanning'); await delay(450);
    setStatus('thinking'); await delay(550);
    setStatus('searching'); await delay(380);
    setStatus('coding');

    try {
      const res = await axios.post('http://localhost:5000/api/analyze', { query });
      const { text: reply, toolCalls } = res.data;
      const ts2 = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      setMessages(p => [...p, {
        role: 'assistant', content: reply,
        toolCalls: toolCalls || [], timestamp: ts2,
      }]);
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

  const techStack = project.techStack?.length
    ? project.techStack
    : ['Node.js', 'React', 'TypeScript', 'Express', 'NVIDIA NIM'];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }

        body {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #0a0e1a;
          color: #e2e8f0;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-feature-settings: 'cv02','cv03','cv04','cv11';
        }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes dots {
          0%,80%,100%{opacity:0.2;transform:scale(0.8)}
          40%{opacity:1;transform:scale(1)}
        }
        @keyframes fadeSlideIn {
          from{opacity:0;transform:translateY(6px)}
          to{opacity:1;transform:translateY(0)}
        }

        textarea { font-family: 'Plus Jakarta Sans', sans-serif; }

        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

        /* Glass utility */
        .glass {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .glass-strong {
          background: rgba(255,255,255,0.07);
          backdrop-filter: blur(32px) saturate(200%);
          -webkit-backdrop-filter: blur(32px) saturate(200%);
          border: 1px solid rgba(255,255,255,0.12);
        }

        /* Sidebar overlay on mobile */
        .sidebar-overlay {
          display: none;
          position: fixed; inset: 0; z-index: 40;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
        }
        @media (max-width: 768px) {
          .sidebar-overlay.open { display: block; }
          .sidebar {
            position: fixed !important;
            left: 0 !important; top: 0 !important; bottom: 0 !important;
            z-index: 50;
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
          }
          .sidebar.open { transform: translateX(0); }
          .mobile-topbar { display: flex !important; }
        }
        @media (min-width: 769px) {
          .sidebar { transform: none !important; }
          .mobile-topbar { display: none !important; }
        }

        /* Markdown */
        .md p { margin-bottom: 10px; line-height: 1.8; font-size: 14px; }
        .md h1,.md h2,.md h3 { font-weight: 600; margin: 16px 0 7px; color: #f1f5f9; }
        .md h3 { font-size: 14px; }
        .md h2 { font-size: 15px; }
        .md h1 { font-size: 16px; }
        .md ul,.md ol { padding-left: 18px; margin-bottom: 10px; }
        .md li { margin-bottom: 5px; font-size: 14px; line-height: 1.75; }
        .md code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.1);
          color: #a5f3c7;
          padding: 1px 6px; border-radius: 5px;
        }
        .md pre {
          background: rgba(0,0,0,0.35);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 14px 16px;
          overflow-x: auto;
          margin-bottom: 12px;
        }
        .md pre code {
          background: none; border: none; padding: 0;
          font-size: 12.5px; color: #e2e8f0;
        }
        .md table {
          width: 100%; border-collapse: collapse;
          margin-bottom: 12px; font-size: 13px;
        }
        .md th {
          background: rgba(255,255,255,0.06);
          padding: 7px 12px; text-align: left;
          border: 1px solid rgba(255,255,255,0.08);
          font-weight: 600; color: #f1f5f9;
        }
        .md td {
          padding: 7px 12px;
          border: 1px solid rgba(255,255,255,0.06);
          color: #cbd5e1;
        }
        .md strong { font-weight: 600; color: #f1f5f9; }
        .md blockquote {
          border-left: 2px solid rgba(99,102,241,0.6);
          padding-left: 14px; color: #94a3b8;
          margin-bottom: 10px;
        }
        .md a { color: #60a5fa; text-decoration: underline; }

        /* Message animation */
        .msg-appear { animation: fadeSlideIn 0.22s ease both; }

        /* Suggested button hover */
        .suggest-btn:hover {
          background: rgba(255,255,255,0.07) !important;
          border-color: rgba(255,255,255,0.15) !important;
          transform: translateY(-1px);
        }
      `}</style>

      {/* Ambient background orbs */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '-10%',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', right: '-10%',
          width: 700, height: 700, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '40%',
          width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* Mobile sidebar overlay */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div style={{ display: 'flex', height: '100vh', position: 'relative', zIndex: 1 }}>

        {/* ── Sidebar ── */}
        <aside
          className={`glass-strong sidebar${sidebarOpen ? ' open' : ''}`}
          style={{
            width: 260, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 0,
          }}
        >
          {/* Brand header */}
          <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: -0.5,
                boxShadow: '0 0 16px rgba(99,102,241,0.4)',
              }}>A</div>
              <div>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: '#f1f5f9',
                  letterSpacing: -0.3,
                }}>Analyst Agent</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: '#34d399',
                    boxShadow: '0 0 6px #34d399',
                    display: 'inline-block',
                  }} />
                  <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', fontFamily: "'JetBrains Mono', monospace" }}>
                    llama-3.3-70b · online
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable sidebar content */}
          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
            {/* Project section */}
            <div style={{ padding: '14px 16px' }}>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: 'rgba(255,255,255,0.25)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                marginBottom: 10,
              }}>Project</div>

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
                  background: 'rgba(99,102,241,0.12)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 9, fontSize: 12, fontWeight: 500,
                  color: '#a5b4fc',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'all 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.2)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.5)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.12)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.3)';
                }}
              >
                <span>📂</span> Pilih Folder Project
              </button>

              {selectedPath && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  marginBottom: 4, padding: '4px 6px',
                  background: 'rgba(255,255,255,0.04)', borderRadius: 6,
                }}>
                  <span style={{ fontSize: 12 }}>📁</span>
                  <span style={{
                    fontSize: 11.5, fontWeight: 500,
                    color: 'rgba(255,255,255,0.65)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {selectedPath}
                  </span>
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 4, padding: '4px 6px',
              }}>
                <span style={{ fontSize: 12 }}>📁</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.65)' }}>
                  project-analyst-agent
                </span>
              </div>

              {project.totalFiles > 0 && (
                <div style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.3)',
                  marginBottom: 8, paddingLeft: 20,
                }}>
                  {project.totalFiles} file terdeteksi
                </div>
              )}

              <div style={{
                paddingLeft: 4, paddingTop: 4,
                borderTop: '1px solid rgba(255,255,255,0.05)',
                marginTop: 4,
              }}>
                <FileTree nodes={project.files || FALLBACK_FILES} />
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />

            {/* Tech stack */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: 'rgba(255,255,255,0.25)',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                marginBottom: 9,
              }}>Tech stack</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {techStack.map(t => (
                  <span key={t} style={{
                    fontSize: 11, fontWeight: 500,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, padding: '2px 8px',
                    color: 'rgba(255,255,255,0.55)',
                  }}>{t}</span>
                ))}
              </div>
            </div>

            {/* Skills aktif */}
            {project.skills?.length > 0 && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                <div style={{ padding: '12px 16px' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600,
                    color: 'rgba(255,255,255,0.25)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    marginBottom: 9,
                  }}>Skills aktif</div>
                  {project.skills.map(s => (
                    <div key={s} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 12, color: 'rgba(255,255,255,0.5)',
                      padding: '3px 0',
                    }}>
                      <span style={{
                        width: 4, height: 4, borderRadius: '50%',
                        background: '#60a5fa',
                        boxShadow: '0 0 5px rgba(96,165,250,0.6)',
                        flexShrink: 0, display: 'inline-block',
                      }} />
                      {s}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* New chat footer */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}>
            <button
              onClick={() => { setMessages([]); setInput(''); textareaRef.current?.focus(); setSidebarOpen(false); }}
              style={{
                width: '100%', padding: '8px 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 9, fontSize: 12, fontWeight: 500,
                color: 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
                (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)';
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Chat baru
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          minWidth: 0, overflow: 'hidden',
        }}>

          {/* Mobile topbar */}
          <div
            className="mobile-topbar"
            style={{
              display: 'none',
              alignItems: 'center', gap: 12,
              padding: '12px 16px',
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '6px 10px',
                color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                fontSize: 16, lineHeight: 1,
                fontFamily: 'inherit',
              }}
            >☰</button>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>
              Analyst Agent
            </span>
            <div style={{ marginLeft: 'auto' }}>
              <StatusDot status={status} />
            </div>
          </div>

          {/* Desktop topbar */}
          <div style={{
            padding: '13px 28px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 52,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.4)' }}>
              {messages.length === 0 ? 'Sesi baru' : 'Percakapan aktif'}
            </span>
            <div style={{ marginLeft: 'auto' }}>
              <StatusDot status={status} />
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto',
            padding: '28px 24px',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>
            {messages.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 24, padding: '40px 16px',
                maxWidth: 520, margin: '0 auto', width: '100%',
              }}>
                {/* Hero icon */}
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(59,130,246,0.2))',
                  border: '1px solid rgba(99,102,241,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: '0 0 30px rgba(99,102,241,0.15)',
                }}>💬</div>

                <div style={{ textAlign: 'center' }}>
                  <p style={{
                    fontSize: 18, fontWeight: 600,
                    color: '#f1f5f9', marginBottom: 8, letterSpacing: -0.3,
                  }}>
                    Tanya tentang project kamu
                  </p>
                  <p style={{
                    fontSize: 13.5, color: 'rgba(255,255,255,0.4)',
                    lineHeight: 1.7, maxWidth: 360,
                  }}>
                    Agent akan membaca kode, memori, dan skills aktif untuk menjawab pertanyaanmu.
                  </p>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 8, width: '100%',
                }}>
                  {SUGGESTED.map(s => (
                    <button
                      key={s}
                      className="suggest-btn"
                      onClick={() => handleSend(s)}
                      style={{
                        padding: '11px 14px', textAlign: 'left',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 11, fontSize: 12.5,
                        color: 'rgba(255,255,255,0.6)',
                        cursor: 'pointer', lineHeight: 1.5,
                        transition: 'all 0.2s',
                        fontFamily: 'inherit',
                      }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={i}
                    className="msg-appear"
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                      flexDirection: isUser ? 'row-reverse' : 'row',
                      maxWidth: 820, width: '100%',
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: isUser
                        ? 'linear-gradient(135deg,#6366f1,#3b82f6)'
                        : 'rgba(99,102,241,0.15)',
                      color: isUser ? '#fff' : '#a5b4fc',
                      border: isUser ? 'none' : '1px solid rgba(99,102,241,0.25)',
                      boxShadow: isUser ? '0 0 12px rgba(99,102,241,0.3)' : 'none',
                    }}>
                      {isUser ? 'K' : 'AI'}
                    </div>

                    <div style={{ maxWidth: 'calc(100% - 42px)' }}>
                      {/* Tool calls */}
                      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                          {msg.toolCalls.map((t, j) => (
                            <span key={j} style={{
                              fontSize: 10.5,
                              fontFamily: "'JetBrains Mono', monospace",
                              color: 'rgba(255,255,255,0.35)',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: 5,
                              padding: '2px 8px',
                            }}>⚙ {t}</span>
                          ))}
                        </div>
                      )}

                      {/* Bubble */}
                      <div style={{
                        padding: '11px 15px',
                        borderRadius: 14,
                        borderTopLeftRadius: isUser ? 14 : 3,
                        borderTopRightRadius: isUser ? 3 : 14,
                        fontSize: 14, lineHeight: 1.75,
                        ...(isUser ? {
                          background: 'linear-gradient(135deg, rgba(99,102,241,0.5), rgba(59,130,246,0.45))',
                          border: '1px solid rgba(99,102,241,0.35)',
                          color: '#f1f5f9',
                          backdropFilter: 'blur(12px)',
                          boxShadow: '0 4px 20px rgba(99,102,241,0.15)',
                        } : {
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: '#e2e8f0',
                          backdropFilter: 'blur(12px)',
                        }),
                      }}>
                        {isUser ? msg.content : (
                          <div className="md">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                      </div>

                      {/* Timestamp */}
                      <div style={{
                        fontSize: 10.5, color: 'rgba(255,255,255,0.2)',
                        marginTop: 5,
                        textAlign: isUser ? 'right' : 'left',
                        paddingRight: isUser ? 2 : 0,
                        paddingLeft: isUser ? 0 : 2,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{msg.timestamp}</div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Typing indicator */}
            {loading && (
              <div className="msg-appear" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: 'rgba(99,102,241,0.15)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99,102,241,0.25)',
                }}>AI</div>
                <div style={{
                  padding: '13px 16px', borderRadius: 14, borderTopLeftRadius: 3,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(12px)',
                  display: 'flex', gap: 5, alignItems: 'center',
                }}>
                  {[0, 150, 300].map(d => (
                    <span key={d} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'rgba(165,180,252,0.6)',
                      display: 'inline-block',
                      animation: `dots 1.2s ease-in-out ${d}ms infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input area ── */}
          <div style={{
            padding: '14px 24px 22px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 14,
              padding: '11px 12px',
              backdropFilter: 'blur(20px)',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
              onFocusCapture={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(99,102,241,0.5)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(99,102,241,0.08)';
              }}
              onBlurCapture={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.1)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
              }}
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
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault(); handleSend();
                  }
                }}
                placeholder="Tanya tentang project kamu..."
                style={{
                  flex: 1, background: 'transparent',
                  border: 'none', resize: 'none',
                  fontSize: 14, color: '#e2e8f0',
                  lineHeight: 1.6, maxHeight: 130,
                  overflow: 'auto', outline: 'none',
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                style={{
                  width: 34, height: 34, borderRadius: 10, border: 'none',
                  background: loading || !input.trim()
                    ? 'rgba(255,255,255,0.06)'
                    : 'linear-gradient(135deg, #6366f1, #3b82f6)',
                  color: loading || !input.trim() ? 'rgba(255,255,255,0.2)' : '#fff',
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0,
                  transition: 'all 0.18s',
                  boxShadow: loading || !input.trim()
                    ? 'none'
                    : '0 0 14px rgba(99,102,241,0.35)',
                }}
                onMouseEnter={e => {
                  if (!loading && input.trim()) {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05)';
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                }}
                aria-label="Kirim"
              >↑</button>
            </div>
            <p style={{
              fontSize: 11, color: 'rgba(255,255,255,0.18)',
              textAlign: 'center', marginTop: 9,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              Ctrl+Enter untuk kirim · /scan /memory /tree /help
            </p>
          </div>
        </main>
      </div>
    </>
  );
}