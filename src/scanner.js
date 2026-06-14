import fs from 'fs/promises';
import path from 'path';
import { existsSync, statSync } from 'fs';

// Files/dirs to always ignore
const IGNORE = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', '.cache',
  'coverage', '__pycache__', '.venv', 'venv', 'env', '.env',
  '.DS_Store', 'Thumbs.db', '.idea', '.vscode', '*.min.js', '*.map',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
]);

const CODE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.py', '.go',
  '.java', '.kt', '.swift', '.rb', '.php', '.cs', '.cpp', '.c',
  '.rs', '.dart', '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.env.example', '.md',
  '.graphql', '.prisma', '.sql',
]);

const UI_EXTS = new Set(['.jsx', '.tsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass']);

export class ProjectScanner {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this._cache = new Map();
  }

  // Fast scan - just structure overview
  async quickScan() {
    const techStack = await this.detectTechStack();
    const structure = await this.getStructure(this.projectPath, 0, 2);
    const totalFiles = await this.countFiles(this.projectPath);

    return { techStack, structure, totalFiles, projectPath: this.projectPath };
  }

  // Deep scan - reads important files
  async deepScan() {
    const quick = await this.quickScan();
    const keyFiles = await this.findKeyFiles();
    const uiComponents = await this.findUIComponents();

    return {
      ...quick,
      keyFiles: keyFiles.length,
      uiComponents: uiComponents.length,
      keyFilesList: keyFiles,
      uiComponentsList: uiComponents,
    };
  }

  // Get ASCII tree representation
  async getTree(maxDepth = 4) {
    return this._buildTree(this.projectPath, '', 0, maxDepth);
  }

  async _buildTree(dirPath, prefix, depth, maxDepth) {
    if (depth > maxDepth) return '';

    let result = '';
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return '';
    }

    const filtered = entries
      .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const ext = path.extname(entry.name);
      const icon = entry.isDirectory() ? '📁' : getFileIcon(ext);

      result += `${prefix}${connector}${icon} ${entry.name}\n`;

      if (entry.isDirectory()) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        result += await this._buildTree(path.join(dirPath, entry.name), newPrefix, depth + 1, maxDepth);
      }
    }

    return result;
  }

  // Read a specific file
  async readFile(filePath) {
    // Support relative paths
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectPath, filePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    // Check cache
    if (this._cache.has(fullPath)) {
      return this._cache.get(fullPath);
    }

    try {
      const stat = statSync(fullPath);
      if (stat.size > 500_000) {
        return `[File terlalu besar: ${(stat.size / 1024).toFixed(1)}KB]`;
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      this._cache.set(fullPath, content);
      return content;
    } catch {
      return null;
    }
  }

  // Search for files matching pattern
  async findFiles(pattern, maxResults = 20) {
    const results = [];
    const regex = new RegExp(pattern, 'i');
    await this._walkFiles(this.projectPath, (filePath) => {
      if (regex.test(filePath) && results.length < maxResults) {
        results.push(filePath.replace(this.projectPath + '/', ''));
      }
    });
    return results;
  }

  // Search for content inside files
  async grepFiles(searchTerm, extensions = null, maxResults = 15) {
    const results = [];
    const regex = new RegExp(searchTerm, 'i');

    await this._walkFiles(this.projectPath, async (filePath) => {
      if (results.length >= maxResults) return;

      const ext = path.extname(filePath);
      if (extensions && !extensions.includes(ext)) return;
      if (!CODE_EXTS.has(ext)) return;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            matches.push({ line: idx + 1, content: line.trim() });
          }
        });

        if (matches.length > 0) {
          results.push({
            file: filePath.replace(this.projectPath + '/', ''),
            matches: matches.slice(0, 5),
          });
        }
      } catch { /* skip unreadable */ }
    });

    return results;
  }

  // Find UI components
  async findUIComponents() {
    const results = [];
    await this._walkFiles(this.projectPath, (filePath) => {
      const ext = path.extname(filePath);
      if (UI_EXTS.has(ext)) {
        results.push(filePath.replace(this.projectPath + '/', ''));
      }
    });
    return results.slice(0, 50);
  }

  // Find key files (entry points, config, etc.)
  async findKeyFiles() {
    const keyPatterns = [
      'package.json', 'requirements.txt', 'Cargo.toml', 'go.mod',
      'index.js', 'index.ts', 'main.js', 'main.ts', 'main.py', 'app.py',
      'App.jsx', 'App.tsx', 'App.vue',
      'index.html', 'README.md', 'docker-compose.yml', 'Dockerfile',
      '.env.example', 'next.config.js', 'vite.config.js', 'webpack.config.js',
      'tailwind.config.js', 'tsconfig.json',
    ];

    const found = [];
    for (const pattern of keyPatterns) {
      const files = await this.findFiles(pattern, 3);
      found.push(...files);
    }
    return [...new Set(found)];
  }

  // Find config files (package.json, tsconfig.json, etc.)
  async findConfigFiles() {
    const configPatterns = [
      'package.json',
      'tsconfig.json',
      'webpack.config.js',
      '.eslintrc',
      '.babelrc',
      '.prettierrc',
      'vite.config.js',
      'next.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      'jest.config.js',
      'cypress.config.js',
    ];

    const configFiles = [];
    for (const pattern of configPatterns) {
      const files = await this.findFiles(pattern);
      configFiles.push(...files);
    }

    return configFiles;
  }

  // Detect tech stack from files
  async detectTechStack() {
    const stack = new Set();
    const stackFiles = {
      'package.json': () => this._detectNodeStack(),
      'requirements.txt': () => stack.add('Python'),
      'Pipfile': () => stack.add('Python'),
      'pyproject.toml': () => stack.add('Python'),
      'Cargo.toml': () => stack.add('Rust'),
      'go.mod': () => stack.add('Go'),
      'pom.xml': () => stack.add('Java/Maven'),
      'build.gradle': () => stack.add('Java/Gradle'),
      'Gemfile': () => stack.add('Ruby'),
      'composer.json': () => stack.add('PHP'),
      'pubspec.yaml': () => stack.add('Flutter/Dart'),
    };

    for (const [file, detector] of Object.entries(stackFiles)) {
      if (existsSync(path.join(this.projectPath, file))) {
        await detector();
      }
    }

    return [...stack];
  }

  async _detectNodeStack() {
    try {
      const pkgPath = path.join(this.projectPath, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      const frameworks = {
        next: 'Next.js',
        nuxt: 'Nuxt.js',
        react: 'React',
        vue: 'Vue',
        '@angular/core': 'Angular',
        svelte: 'Svelte',
        express: 'Express',
        fastify: 'Fastify',
        nestjs: 'NestJS',
        'remix': 'Remix',
        astro: 'Astro',
        electron: 'Electron',
        'react-native': 'React Native',
      };

      const detected = new Set(['Node.js']);
      for (const [dep, name] of Object.entries(frameworks)) {
        if (allDeps[dep]) detected.add(name);
      }
      if (allDeps['typescript'] || allDeps['@types/node']) detected.add('TypeScript');
      if (allDeps['tailwindcss']) detected.add('Tailwind CSS');
      if (allDeps['prisma'] || allDeps['@prisma/client']) detected.add('Prisma');

      return [...detected].join(', ');
    } catch {
      return 'Node.js';
    }
  }

  // Get context summary for system prompt
  async getContextSummary() {
    const stack = await this.detectTechStack();
    const keyFiles = await this.findKeyFiles();
    const uiComponents = await this.findUIComponents();
    const tree = await this.getTree(3);

    let pkgInfo = '';
    try {
      const pkg = JSON.parse(await this.readFile('package.json') || '{}');
      pkgInfo = `Project: ${pkg.name || 'unknown'} v${pkg.version || '?'}\nDescription: ${pkg.description || '-'}`;
    } catch { /* no package.json */ }

    return {
      projectPath: this.projectPath,
      techStack: stack,
      keyFiles,
      uiComponentCount: uiComponents.length,
      uiComponents: uiComponents.slice(0, 20),
      tree: tree.slice(0, 3000), // Limit tree size
      pkgInfo,
    };
  }

  async getStructure(dirPath, depth, maxDepth) {
    if (depth > maxDepth) return [];
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  }

  async countFiles(dirPath) {
    let count = 0;
    await this._walkFiles(dirPath, () => count++);
    return count;
  }

  async _walkFiles(dirPath, callback) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._walkFiles(fullPath, callback);
      } else {
        await callback(fullPath);
      }
    }
  }
}

function getFileIcon(ext) {
  const icons = {
    '.js': '📄', '.jsx': '⚛️', '.ts': '📘', '.tsx': '⚛️',
    '.vue': '💚', '.svelte': '🧡', '.py': '🐍', '.go': '🐹',
    '.java': '☕', '.rs': '🦀', '.rb': '💎', '.php': '🐘',
    '.html': '🌐', '.css': '🎨', '.scss': '🎨', '.json': '📋',
    '.md': '📝', '.yml': '⚙️', '.yaml': '⚙️', '.sql': '🗄️',
    '.env': '🔒', '.sh': '🐚', '.dockerfile': '🐳',
  };
  return icons[ext] || '📄';
}
