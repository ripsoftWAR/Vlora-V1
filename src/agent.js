import { chalk } from './colors.js';
import { buildTools } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { StealthMemory, GhostProfile } from './stealth-memory.js';

// ── Provider configs ────────────────────────────────────────────
const PROVIDERS = {
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    envKey: 'NVIDIA_API_KEY',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',   // DeepSeek V4 Flash (lebih cepat)
    envKey: 'DEEPSEEK_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
    envKey: 'OPENROUTER_API_KEY',
  },
};

export class Agent {
  constructor({ apiKey, memory, scanner, projectPath, skillManager }) {
    // Detect provider from env or default to nvidia
    const providerName = process.env.AI_PROVIDER?.toLowerCase() || 'nvidia';
    const provider = PROVIDERS[providerName] || PROVIDERS.nvidia;

    this.apiKey = apiKey || process.env[provider.envKey];
    this.baseURL = provider.baseURL;
    this.model = process.env.AI_MODEL || provider.defaultModel;
    this.providerName = providerName;

    this.memory = memory;
    this.scanner = scanner;
    this.projectPath = projectPath;
    this.skillManager = skillManager;
    this.conversationHistory = [];

    // 🕵️ Stealth Memory — inisialisasi diam-diam
    this.stealthMemory = new StealthMemory(projectPath);
    this._stealthInitialized = false;

    // 👻 Ghost Profile — deteksi device & user otomatis
    this.ghostProfile = new GhostProfile();
    this._ghostProfileData = null;

    // 🌐 Global Memory — cache setelah di-load
    this._globalContext = null;
  }

  /**
   * 🌐 Load global memory (lintas project) — dipanggil pas startup
   */
  async loadGlobalMemory() {
    try {
      this._globalContext = await this.memory.getGlobalContext();
      // Catat project ini di history
      const projectInfo = await this.scanner.getContextSummary();
      await this.memory.recordProject(this.projectPath, projectInfo.techStack);
      return this._globalContext;
    } catch {
      this._globalContext = { userPreferences: [], facts: [], decisions: [], constraints: [], projectHistory: [] };
      return this._globalContext;
    }
  }

  /**
   * 🔄 Restore percakapan dari session yang tersimpan di disk
   * Dipanggil pas startup biar agent inget percakapan sebelumnya
   */
  async restoreConversation() {
    try {
      const session = await this.memory.getOrCreateSession(this.projectPath);
      if (session && session.messages && session.messages.length > 0) {
        // Restore messages ke conversationHistory
        this.conversationHistory = session.messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        }));
        console.log(`🔄 Restored ${this.conversationHistory.length} messages from session`);
      }
      return this.conversationHistory.length;
    } catch (err) {
      console.warn('⚠️ Gagal restore conversation:', err.message);
      return 0;
    }
  }

  /**
   * 👻 Inisialisasi Ghost Profile — deteksi device & user
   * Dipanggil otomatis di chatStream pertama kali
   */
  async _initGhostProfile() {
    if (this._ghostProfileData) return this._ghostProfileData;

    try {
      // 1. Scan device saat ini
      const currentDevice = await this.ghostProfile.scan();

      // 2. Load profil yang tersimpan
      let savedProfile = await this.stealthMemory.load('ghost_profile');
      if (!savedProfile) {
        savedProfile = {
          user: {
            name: currentDevice.username,
            inferredJob: currentDevice.inferredJob,
            firstInteraction: new Date().toISOString(),
            lastInteraction: new Date().toISOString(),
          },
          knownDevices: [],
          preferences: [],
        };
      }

      // 3. Cek apakah device ini sudah dikenal
      const comparison = await this.ghostProfile.compare(savedProfile.knownDevices);
      
      if (comparison.isNew) {
        // Device baru — tambahkan ke daftar
        savedProfile.knownDevices.push({
          ...currentDevice,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        });
        
        // Update inferred job kalau device baru punya clue berbeda
        if (currentDevice.inferredJob !== 'unknown' && 
            savedProfile.user.inferredJob === 'unknown') {
          savedProfile.user.inferredJob = currentDevice.inferredJob;
        }
      } else {
        // Device dikenal — update lastSeen
        const known = savedProfile.knownDevices.find(d => 
          d.machineId === currentDevice.machineId || 
          (d.hostname === currentDevice.hostname && d.username === currentDevice.username)
        );
        if (known) {
          known.lastSeen = new Date().toISOString();
        }
        
        // ✅ Device dikenal — set flag greeting done biar gak sapa lagi
        // Ini penting: kalau user restart FLORA, device tetap dikenal,
        // jadi greeting gak perlu muncul lagi
        try {
          await this.stealthMemory.save(`greeting_done_${currentDevice.machineId}`, true);
        } catch {}
      }

      // 4. Set device saat ini
      savedProfile.currentDevice = currentDevice;
      savedProfile.user.lastInteraction = new Date().toISOString();

      // 5. Cek apakah user punya nama panggilan tersimpan
      const preferredName = await this.stealthMemory.load('user_preferred_name');
      if (preferredName) {
        savedProfile.user.name = preferredName;
      }

      // 6. Simpan kembali
      await this.stealthMemory.save('ghost_profile', savedProfile);
      this._ghostProfileData = savedProfile;

      return savedProfile;
    } catch (err) {
      console.warn('⚠️ GhostProfile: Gagal inisialisasi:', err.message);
      return null;
    }
  }

  /**
   * 👻 Dapatkan sapaan berdasarkan konteks device
   * Dipanggil pas pertama kali user chat di device baru
   * 
   * ⚠️ PENTING: Greeting cuma muncul SEKALI per device — setelah itu
   * disimpan flag `greeting_done_<machineId>` di stealth memory.
   * Jadi kalau user restart FLORA atau cabut flashdisk, greeting
   * gak muncul lagi.
   */
  async _getGreeting() {
    const profile = await this._initGhostProfile();
    if (!profile) return '';

    const device = profile.currentDevice;
    const user = profile.user;
    const knownDevices = profile.knownDevices;

    // Cek apakah user punya nama panggilan tersimpan
    const preferredName = await this.stealthMemory.load('user_preferred_name');
    const displayName = preferredName || user.name || 'Sobat';

    // ── Cek flag greeting udah pernah ditampilkan untuk device ini ──
    const greetingFlagKey = `greeting_done_${device.machineId}`;
    const greetingDone = await this.stealthMemory.load(greetingFlagKey);
    if (greetingDone) {
      return ''; // Udah pernah disapa di device ini — diam aja
    }

    // ── Device BARU (belum pernah dikenal sama sekali) ──
    // Artinya: knownDevices cuma berisi device saat ini (baru ditambahkan)
    const isBrandNewDevice = knownDevices.length === 1 && 
      knownDevices[0].machineId === device.machineId &&
      knownDevices[0].firstSeen === knownDevices[0].lastSeen;

    if (isBrandNewDevice) {
      let greeting = `👋 Halo, **${displayName}**!`;
      if (user.inferredJob && user.inferredJob !== 'unknown') {
        const jobLabels = {
          developer: 'Developer',
          designer: 'Desainer',
          mahasiswa: 'Mahasiswa',
          akuntan: 'Akuntan/Finance',
          penulis: 'Penulis',
          marketing: 'Marketing',
        };
        greeting += ` Kayaknya kamu seorang **${jobLabels[user.inferredJob] || user.inferredJob}** ya?`;
      }
      // Tandai udah disapa
      await this.stealthMemory.save(greetingFlagKey, true);
      return greeting;
    }

    // ── Device LAMA tapi pindah ke device baru ──
    // Cari device sebelumnya (bukan device saat ini)
    const prevDevice = knownDevices.find(d => d.machineId !== device.machineId);
    if (prevDevice) {
      let greeting = `👋 Halo lagi, **${displayName}**!`;
      greeting += ` Baru pertama di **${device.deviceLabel}** ya?`;
      
      if (device.inferredJob !== prevDevice.inferredJob && device.inferredJob !== 'unknown') {
        const jobLabels = {
          developer: 'Developer',
          designer: 'Desainer',
          mahasiswa: 'Mahasiswa',
          akuntan: 'Akuntan/Finance',
          penulis: 'Penulis',
          marketing: 'Marketing',
        };
        greeting += ` Kayaknya ini komputer ${jobLabels[device.inferredJob] || device.inferredJob} — beda dari sebelumnya.`;
      }
      // Tandai udah disapa
      await this.stealthMemory.save(greetingFlagKey, true);
      return greeting;
    }

    // ── Device yang sudah dikenal — diam aja, gak usah sapa ──
    // Tandai juga biar aman
    await this.stealthMemory.save(greetingFlagKey, true);
    return '';
  }

  /**
   * 🔍 Cari memory berdasarkan query — bisa dipanggil dari tool
   */
  async searchMemory(query) {
    const results = await this.memory.searchMemory(query, { maxResults: 5 });
    const globalResults = await this.memory.searchGlobalPreferences(query);
    return [...results, ...globalResults];
  }

  async chat(userMessage, onChunk) {
    return this.chatStream(userMessage, {
      onToolStart: (name) => { if (onChunk) onChunk(chalk.dim(`\n[🔧 ${name}]\n`)); },
      onToolEnd: (name, preview) => { if (onChunk) onChunk(chalk.dim(`   → ${preview}\n`)); },
      onToken: (token) => { if (onChunk) onChunk(token); },
      onDone: () => {},
      onError: (err) => { throw err; },
    });
  }

  /**
   * Streaming chat with structured callbacks for realtime UI
   * @param {string} userMessage
   * @param {{ onToolStart, onToolEnd, onToken, onDone, onError }} callbacks
   */
  async chatStream(userMessage, callbacks = {}) {
    const { onToolStart, onToolEnd, onToken, onDone, onError } = callbacks;

    // 🔄 Restore percakapan dari session disk — biar inget setelah restart
    if (this.conversationHistory.length === 0) {
      await this.restoreConversation();
    }

    // 👻 Ghost Profile — deteksi device & kasih sapaan pas pertama kali
    if (!this._ghostProfileData) {
      await this._initGhostProfile();
      const greeting = await this._getGreeting();
      if (greeting) {
        // Kirim greeting sebagai pesan pertama (tidak masuk history)
        if (onToken) onToken(`\n${greeting}\n\n`);
      }
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });
    await this.memory.addMessage(this.projectPath, { role: 'user', content: userMessage });

    const projectContext = await this.scanner.getContextSummary();
    const memoryContext  = await this.memory.getRecentContext(this.projectPath);
    const skillsContext  = this.skillManager ? await this.skillManager.loadContext() : '';

    // 🌐 Inject global memory (lintas project) — preferensi user dari project lain
    if (!this._globalContext) {
      await this.loadGlobalMemory();
    }
    const globalContext = this._globalContext || { userPreferences: [], facts: [], decisions: [], constraints: [], projectHistory: [] };

    // 🕵️ Inject stealth memory context (diam-diam, tidak kelihatan di chat)
    const stealthContext = await this.stealthMemory.getContext();
    const stealthInjected = stealthContext ? `\n${stealthContext}` : '';

    // Gabung global context ke memoryContext biar diproses di system prompt
    const enrichedMemoryContext = {
      ...memoryContext,
      globalPreferences: globalContext.userPreferences || [],
      globalFacts: globalContext.facts || [],
      globalDecisions: globalContext.decisions || [],
      globalConstraints: globalContext.constraints || [],
      projectHistory: globalContext.projectHistory || [],
    };

    const systemPrompt   = buildSystemPrompt(projectContext, enrichedMemoryContext, skillsContext) + stealthInjected;
    const tools          = buildTools(this.scanner);

    let finalText = '';
    let continueLoop = true;
    let loopGuard = 0;
    const MAX_TOOL_LOOPS = 10; // safety: max 10 tool call rounds

    while (continueLoop) {
      loopGuard++;
      if (loopGuard > MAX_TOOL_LOOPS) {
        console.warn('⚠️ Tool call loop exceeded max iterations — breaking');
        if (onError) onError(new Error('Tool call loop terlalu panjang'));
        break;
      }

      // ── Real streaming via SSE ─────────────────────────────────
      const stream = this.callAPIStream({ systemPrompt, messages: this.conversationHistory, tools });

      let content = '';
      const toolCallMap = {};  // index → accumulated tool_call
      let streamComplete = false;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // ── Text token ──────────────────────────────────────────
        // DeepSeek V4 Flash kirim reasoning_content duluan sebelum content
        // Kita tangkap reasoning_content sebagai fallback text
        if (delta.content) {
          content += delta.content;
          if (onToken) onToken(delta.content);
        } else if (delta.reasoning_content) {
          // DeepSeek reasoning — tampilkan juga biar user lihat proses berpikir
          content += delta.reasoning_content;
          if (onToken) onToken(delta.reasoning_content);
        }

        // ── Tool call delta ─────────────────────────────────────
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap[idx]) {
              toolCallMap[idx] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            const entry = toolCallMap[idx];
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.function.name += tc.function.name;
            if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
          }
        }

        // ── Finish reason ───────────────────────────────────────
        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason === 'stop' || finishReason === 'tool_calls') {
          streamComplete = true;
        }
      }

      // ── Fallback: kalau finish_reason gak dikirim, cek toolCalls ──
      const toolCalls = Object.values(toolCallMap);

      if (toolCalls.length > 0) {
        // ── Tool call path ──────────────────────────────────────
        const message = { role: 'assistant', tool_calls: toolCalls };
        this.conversationHistory.push(message);

        for (const tc of toolCalls) {
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /**/ }

          // Ambil description dari argumen tool (ditulis agent)
          const description = args?.description || '';

          // 🔄 TRANSLATE TOOL CALL KE BAHASA MANUSIA
          // Kalau description kosong atau terlalu teknis, kita generate sendiri
          let humanDescription = description;
          if (!humanDescription || humanDescription.length < 5) {
            humanDescription = this.translateToolCall(name, args);
          }

          if (onToolStart) onToolStart(name, args, humanDescription);

          const result  = await this.executeTool(name, args, tools);
          const preview = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 150);

          if (onToolEnd) onToolEnd(name, preview);

          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        }

      } else {
        // ── Text response path ─────────────────────────────────
        finalText = content;

        this.conversationHistory.push({ role: 'assistant', content: finalText });
        await this.memory.addMessage(this.projectPath, { role: 'assistant', content: finalText });

        // 🕵️ Auto-extract informasi penting ke stealth memory
        await this.stealthMemory.autoExtract([
            { role: 'user', content: userMessage },
            { role: 'assistant', content: finalText },
        ]);

        if (this.conversationHistory.length > 20) await this._summarizeMemory(systemPrompt);
        continueLoop = false;
      }
    }

    if (onDone) onDone(finalText);
    return finalText;
  }

  /**
   * 🔄 Translate tool call ke bahasa manusia yang natural
   * Dipakai sebagai fallback kalau agent lupa ngasih description
   */
  translateToolCall(name, args) {
    const translations = {
      read_file: () => `Membaca file ${args.file_path || '?'}`,
      write_file: () => `Menulis file ${args.file_path || '?'}`,
      edit_file: () => `Mengedit file ${args.file_path || '?'}`,
      delete_file: () => `Menghapus file ${args.file_path || '?'}`,
      read_multiple_files: () => `Membaca ${(args.file_paths || []).length} file sekaligus`,
      list_files: () => `Melihat struktur folder project`,
      find_files: () => `Mencari file dengan pola "${args.pattern || ''}"`,
      search_in_files: () => `Mencari teks "${args.search_term || ''}" di dalam file`,
      run_command: () => `Menjalankan: ${(args.command || '').slice(0, 60)}`,
      detect_tech_stack: () => `Mendeteksi teknologi yang dipakai project`,
      find_ui_components: () => `Mencari komponen UI${args.filter ? ` dengan filter "${args.filter}"` : ''}`,
      fetch_docs: () => `Mengambil dokumentasi ${args.library || ''}`,
      word_inject: () => `Mengetik teks ke Word — ${(args.text || '').slice(0, 50)}`,
      word_read: () => `Membaca dokumen Word`,
      word_format: () => `Memformat dokumen Word`,
      word_exec: () => `Menjalankan kode Python di Word`,
      excel_inject: () => `Menulis data ke Excel`,
      excel_read: () => `Membaca data dari Excel`,
      excel_format: () => `Memformat spreadsheet Excel`,
      ppt_inject: () => `Mengedit slide PowerPoint`,
      ppt_read: () => `Membaca presentasi PowerPoint`,
      ppt_format: () => `Memformat slide PowerPoint`,
      blender_inject: () => `Memanipulasi model 3D di Blender`,
      blender_socket_inject: () => `Mengirim perintah ke Blender (live)`,
      freecad_inject: () => `Memanipulasi model 3D di FreeCAD`,
      freecad_socket_inject: () => `Mengirim perintah ke FreeCAD (live)`,
      analyze_image: () => `Menganalisis gambar: ${args.file_path || ''}`,
    };

    const translator = translations[name];
    if (translator) return translator();

    // Fallback generik
    const actionMap = {
      read: 'Membaca',
      write: 'Menulis',
      edit: 'Mengedit',
      delete: 'Menghapus',
      create: 'Membuat',
      get: 'Mendapatkan',
      find: 'Mencari',
      search: 'Mencari',
      list: 'Melihat daftar',
      run: 'Menjalankan',
      exec: 'Mengeksekusi',
      apply: 'Menerapkan',
      format: 'Memformat',
      fix: 'Memperbaiki',
      inject: 'Mengirim data ke',
      ping: 'Mengecek koneksi',
      eval: 'Mengevaluasi ekspresi',
      clear: 'Membersihkan',
      export: 'Mengekspor',
      render: 'Merender',
    };

    for (const [prefix, action] of Object.entries(actionMap)) {
      if (name.startsWith(prefix)) {
        const rest = name.replace(prefix, '').replace(/_/g, ' ');
        return `${action} ${rest.trim()}`;
      }
    }

    return `Menjalankan tool ${name.replace(/_/g, ' ')}`;
  }

  /**
   * Sanitasi messages — hapus orphan tool messages yang tidak punya
   * pasangan assistant dengan tool_calls sebelumnya. Ini safety net
   * kalau _summarizeMemory masih lobolos.
   */
  _sanitizeMessages(messages) {
    const cleaned = [];
    // Track tool_call_ids yang "aktif" dari assistant terakhir dengan tool_calls
    let activeToolCallIds = new Set();

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        // Reset: assistant baru dengan tool_calls menggantikan yang lama
        activeToolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
        cleaned.push(msg);
      } else if (msg.role === 'tool') {
        // Hanya izinkan tool message jika tool_call_id-nya dikenal
        if (activeToolCallIds.has(msg.tool_call_id)) {
          cleaned.push(msg);
        }
        // Kalau orphan, skip (tidak di-push)
      } else {
        // user, assistant (tanpa tool_calls), system — selalu aman
        activeToolCallIds.clear();
        cleaned.push(msg);
      }
    }

    return cleaned;
  }

  /**
   * Non-streaming API call — untuk summarization & internal use
   */
  async callAPINonStream({ systemPrompt, messages, tools }) {
    const cleanMessages = this._sanitizeMessages(messages);

    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...cleanMessages],
      max_tokens: 8000,
      temperature: 0.2,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://project-analyst-agent';
      headers['X-Title'] = 'Project Analyst Agent';
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.providerName.toUpperCase()} API ${res.status}: ${err.slice(0, 300)}`);
    }

    return res.json();
  }

  /**
   * Streaming API call — SSE chunk iterator
   * Yields parsed JSON delta chunks for realtime UI
   */
  async *callAPIStream({ systemPrompt, messages, tools }) {
    const cleanMessages = this._sanitizeMessages(messages);

    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...cleanMessages],
      max_tokens: 8000,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: false },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://project-analyst-agent';
      headers['X-Title'] = 'Project Analyst Agent';
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.providerName.toUpperCase()} API ${res.status}: ${err.slice(0, 300)}`);
    }

    // ── Parse SSE stream ──────────────────────────────────────────
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      while (buffer.includes('\n')) {
        const nlIdx = buffer.indexOf('\n');
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // skip unparseable chunks
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            yield parsed;
          } catch {}
        }
      }
    }
  }

  async executeTool(name, args, tools) {
    const def = tools.find((t) => t.function.name === name);
    if (!def?._handler) return `Tool "${name}" tidak ditemukan`;
    try {
      return await def._handler(args);
    } catch (err) {
      return `Error tool ${name}: ${err.message}`;
    }
  }

  /**
   * Cari batas aman untuk memotong history — tidak boleh memotong
   * di tengah grup assistant(tool_calls) → tool → tool → ...
   * Batas aman = mulai dari index message dengan role 'user' atau
   * 'assistant' (tanpa tool_calls) atau 'system'.
   */
  _findSafeCutIndex(maxKeep) {
    const total = this.conversationHistory.length;
    const startIdx = Math.max(0, total - maxKeep);

    // Geser mundur sampai ketemu role yang "aman" sebagai awal
    for (let i = startIdx; i < total; i++) {
      const role = this.conversationHistory[i].role;
      // Tool messages selalu harus didahului assistant dengan tool_calls
      if (role === 'tool') continue;
      // Kalau ini assistant dengan tool_calls, cek apakah tool_call_id di
      // message tool setelahnya valid (masih dalam array)
      if (role === 'assistant' && this.conversationHistory[i].tool_calls) {
        // Pastikan semua tool response setelahnya masih ada
        const toolCallIds = this.conversationHistory[i].tool_calls.map(tc => tc.id);
        let allToolsPresent = true;
        for (let j = i + 1; j < total; j++) {
          const msg = this.conversationHistory[j];
          if (msg.role === 'tool' && toolCallIds.includes(msg.tool_call_id)) {
            continue; // masih dalam grup yang sama
          }
          if (msg.role === 'assistant' && !msg.tool_calls) {
            break; // assistant final — batas aman
          }
          if (msg.role === 'user') break;
          if (msg.role === 'assistant' && msg.tool_calls) {
            // Mulai grup tool_calls baru — berarti semua tool sebelumnya sudah lengkap
            break;
          }
        }
        if (!allToolsPresent) continue; // tool belum lengkap, cari index berikutnya
      }
      // Role 'user', 'assistant' (tanpa tool_calls), atau 'system' — aman
      return i;
    }

    // Fallback: return total (tidak ada batas aman, keep semua)
    return total;
  }

  async _summarizeMemory(systemPrompt) {
    const safeCutIdx = this._findSafeCutIndex(10);
    const toSummarize = this.conversationHistory.slice(0, safeCutIdx);
    const recent      = this.conversationHistory.slice(safeCutIdx);

    if (!toSummarize.length) return;

    try {
      // ── Ringkasan sesi (short-term) ──────────────────────────
      const res = await this.callAPINonStream({
        systemPrompt: 'Kamu adalah conversation summarizer. Ringkas dalam Bahasa Indonesia.',
        messages: [{
          role: 'user',
          content: `Ringkas percakapan berikut (max 200 kata, Bahasa Indonesia):\n\n${
            toSummarize.map((m) => `${m.role}: ${m.content?.slice(0, 200)}`).join('\n')
          }`,
        }],
        tools: null,
      });

      const summary = res.choices[0].message.content;

      // ── Long-term summary (lintas sesi) ──────────────────────
      // Ambil long-term summary yang sudah ada, gabung dengan ringkasan baru
      const currentContext = await this.memory.getRecentContext(this.projectPath);
      const existingLongTerm = currentContext.longTermSummary || '';

      let longTermSummary = summary;
      if (existingLongTerm) {
        // Gabungkan: ringkasan lama + ringkasan baru (via API lagi)
        try {
          const mergeRes = await this.callAPINonStream({
            systemPrompt: 'Kamu adalah knowledge aggregator. Gabungkan pengetahuan tanpa kehilangan informasi penting.',
            messages: [{
              role: 'user',
              content: `Gabungkan dua ringkasan berikut menjadi satu ringkasan kohesif (max 300 kata, Bahasa Indonesia):\n\nRINGKASAN LAMA:\n${existingLongTerm}\n\nRINGKASAN BARU:\n${summary}`,
            }],
            tools: null,
          });
          longTermSummary = mergeRes.choices[0].message.content;
        } catch {
          // Fallback: pakai ringkasan baru
          longTermSummary = summary;
        }
      }

      this.conversationHistory = [
        { role: 'system', content: `[Ringkasan sebelumnya]: ${summary}` },
        ...recent,
      ];
      
      await this.memory.saveSummary(this.projectPath, summary);
      await this.memory.saveLongTermSummary(this.projectPath, longTermSummary);
    } catch {
      this.conversationHistory = recent;
    }
  }
}