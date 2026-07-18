import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
// Load .env
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key) process.env[key] = val;
  }
} catch {}


import { Agent } from './src/agent.js';
import { Memory } from './src/memory.js';
import { ProjectScanner } from './src/scanner.js';
import { SkillManager } from './src/skills.js';
import { chalk } from './src/colors.js';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BANNER = `
${chalk.green('╔══════════════════════════════════════════════════════════╗')}
${chalk.green('║')}  ${chalk.bold.white('🔬 PROJECT ANALYST AGENT')}  ${chalk.gray('powered by DeepSeek · NVIDIA · OpenRouter')}          ${chalk.green('║')}
${chalk.green('║')}  ${chalk.gray('Deep code · Edit code · UI/UX · Memory · Skills')}    ${chalk.green('║')}
${chalk.green('╚══════════════════════════════════════════════════════════╝')}
`;

async function main() {
  console.clear();
  console.log(BANNER);

  const args = process.argv.slice(2);
  const projectPath = args[0] ? path.resolve(args[0]) : process.cwd();
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    console.log(chalk.red('❌ NVIDIA_API_KEY tidak ditemukan!'));
    console.log(chalk.yellow('   Set dulu: export NVIDIA_API_KEY=nvapi-xxxxx'));
    process.exit(1);
  }

  const providerName = process.env.AI_PROVIDER || 'nvidia';
  const modelName = process.env.AI_MODEL || (providerName === 'deepseek' ? 'deepseek-chat' : providerName === 'openrouter' ? 'deepseek/deepseek-chat-v3-0324:free' : 'meta/llama-3.3-70b-instruct');
  console.log(chalk.cyan(`📁 Project: ${chalk.bold(projectPath)}`));
  console.log(chalk.cyan(`🤖 Provider: ${chalk.bold(providerName.toUpperCase())} — ${chalk.gray(modelName)}`));

  const memory = new Memory(path.join(__dirname, 'memory'));
  const scanner = new ProjectScanner(projectPath);
  const skillManager = new SkillManager(path.join(__dirname, 'skills'));
  const agent = new Agent({ apiKey, memory, scanner, projectPath, skillManager });

  // Initial scan
  console.log(chalk.yellow('\n⚡ Scanning project...'));
  const projectInfo = await scanner.quickScan();
  console.log(chalk.green(`✅ Ditemukan: ${projectInfo.totalFiles} file, tech stack: ${projectInfo.techStack.join(', ') || 'unknown'}`));

  // Show installed skills
  const installedSkills = await skillManager.listInstalledNames();
  if (installedSkills.length > 0) {
    console.log(chalk.blue(`📦 Skills aktif: ${installedSkills.join(', ')}`));
  }

  const memContext = await memory.getRecentContext(projectPath);
  if (memContext.summary || memContext.longTermSummary) {
    console.log(chalk.blue(`🧠 Memory loaded: ${memContext.messages?.length || 0} pesan tersimpan`));
    if (memContext.facts?.length) console.log(chalk.gray(`   🔧 ${memContext.facts.length} fakta teknis`));
    if (memContext.decisions?.length) console.log(chalk.gray(`   🎯 ${memContext.decisions.length} keputusan arsitektur`));
    if (memContext.userPreferences?.length) console.log(chalk.gray(`   💡 ${memContext.userPreferences.length} preferensi user`));
    if (memContext.constraints?.length) console.log(chalk.gray(`   ⚠️ ${memContext.constraints.length} constraint`));
  }

  // 🌐 Load global memory (lintas project)
  try {
    const globalContext = await memory.getGlobalContext();
    const hasGlobal = globalContext.userPreferences?.length || globalContext.facts?.length || globalContext.decisions?.length || globalContext.constraints?.length || globalContext.projectHistory?.length;
    if (hasGlobal) {
      console.log(chalk.magenta(`🌐 Global memory: ${globalContext.userPreferences?.length || 0} preferensi, ${globalContext.facts?.length || 0} fakta, ${globalContext.projectHistory?.length || 0} project`));
    }
    // Catat project ini di history
    await memory.recordProject(projectPath, projectInfo.techStack);
  } catch {
    // Global memory opsional — skip kalau error
  }

  console.log(chalk.gray('\nKetik pertanyaanmu. Commands: /skill, /scan, /tree, /memory, /reset, /help, /exit\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('you ▶ '),
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // ── /skill commands ──────────────────────────────────────
    if (input.startsWith('/skill')) {
      const parts = input.split(/\s+/);
      const sub = parts[1];
      const skillName = parts[2];

      if (!sub || sub === 'help') {
        console.log(`
${chalk.cyan('Skill commands:')}
  ${chalk.yellow('/skill list')}              — lihat skills yang terinstall
  ${chalk.yellow('/skill available')}         — lihat semua skills di catalog NVIDIA
  ${chalk.yellow('/skill add <nama>')}        — download & install skill
  ${chalk.yellow('/skill remove <nama>')}     — hapus skill
  ${chalk.yellow('/skill show <nama>')}       — tampilkan isi skill
  
${chalk.gray('Contoh: /skill add rag-blueprint')}
`);
      } else if (sub === 'list') {
        const list = await skillManager.listInstalledNames();
        if (list.length === 0) {
          console.log(chalk.yellow('📦 Belum ada skill terinstall. Coba: /skill add rag-blueprint'));
        } else {
          console.log(chalk.blue(`\n📦 Skills terinstall (${list.length}):`));
          list.forEach((s) => console.log(`  ${chalk.green('✓')} ${s}`));
          console.log('');
        }
      } else if (sub === 'available') {
        const available = skillManager.listAvailable();
        const installed = await skillManager.listInstalledNames();
        console.log(chalk.blue('\n📋 NVIDIA Skills yang tersedia:'));
        available.forEach((s) => {
          const isInstalled = installed.includes(s);
          console.log(`  ${isInstalled ? chalk.green('✓') : chalk.gray('○')} ${s}${isInstalled ? chalk.gray(' (installed)') : ''}`);
        });
        console.log(chalk.gray('\nInstall dengan: /skill add <nama>\n'));
      } else if (sub === 'add') {
        if (!skillName) {
          console.log(chalk.red('❌ Sebutkan nama skill. Contoh: /skill add rag-blueprint'));
        } else {
          process.stdout.write(chalk.yellow(`⬇️  Downloading skill "${skillName}"...`));
          try {
            const result = await skillManager.add(skillName);
            console.log(chalk.green(` ✅ Done!`));
            console.log(chalk.cyan(`   📄 ${result.description}`));
            console.log(chalk.gray(`   ${(result.size / 1024).toFixed(1)}KB disimpan → skills/${skillName}.md`));
            console.log(chalk.blue('   Skill langsung aktif untuk percakapan selanjutnya!\n'));
          } catch (err) {
            console.log(chalk.red(`\n❌ ${err.message}\n`));
          }
        }
      } else if (sub === 'remove') {
        if (!skillName) {
          console.log(chalk.red('❌ Sebutkan nama skill. Contoh: /skill remove rag-blueprint'));
        } else {
          try {
            await skillManager.remove(skillName);
            console.log(chalk.yellow(`🗑️  Skill "${skillName}" dihapus.`));
          } catch (err) {
            console.log(chalk.red(`❌ ${err.message}`));
          }
        }
      } else if (sub === 'show') {
        if (!skillName) {
          console.log(chalk.red('❌ Sebutkan nama skill. Contoh: /skill show rag-blueprint'));
        } else {
          try {
            const content = await skillManager.show(skillName);
            console.log(chalk.cyan(`\n📄 Skill: ${skillName}\n`));
            console.log(chalk.gray('─'.repeat(60)));
            // Print first 60 lines only
            const lines = content.split('\n').slice(0, 60);
            console.log(lines.join('\n'));
            if (content.split('\n').length > 60) {
              console.log(chalk.gray(`\n... (${content.split('\n').length - 60} baris lagi)`));
            }
            console.log(chalk.gray('─'.repeat(60)) + '\n');
          } catch (err) {
            console.log(chalk.red(`❌ ${err.message}`));
          }
        }
      } else {
        console.log(chalk.red(`❌ Sub-command tidak dikenal: ${sub}. Ketik /skill help`));
      }

      rl.prompt();
      return;
    }

    // ── other commands ────────────────────────────────────────
    if (input === '/exit' || input === '/quit') {
      console.log(chalk.yellow('\n👋 Bye! Memory disimpan.\n'));
      process.exit(0);
    }

    if (input === '/help') { printHelp(); rl.prompt(); return; }

    if (input === '/tree') {
      const tree = await scanner.getTree();
      console.log(chalk.cyan('\n📂 Project Tree:\n') + tree);
      rl.prompt();
      return;
    }

    if (input === '/scan') {
      console.log(chalk.yellow('🔄 Re-scanning...'));
      const info = await scanner.deepScan();
      console.log(chalk.green(JSON.stringify(info, null, 2)));
      rl.prompt();
      return;
    }

    if (input === '/memory') {
      const mem = await memory.getAll(projectPath);
      console.log(chalk.blue('\n🧠 Memory:\n') + chalk.gray(JSON.stringify(mem, null, 2)));
      rl.prompt();
      return;
    }

    if (input === '/reset') {
      await memory.reset(projectPath);
      console.log(chalk.red('🗑️  Memory direset.'));
      rl.prompt();
      return;
    }

    // ── agent chat ────────────────────────────────────────────
    process.stdout.write(chalk.gray('\nagent ▶ '));
    try {
      await agent.chat(input, (chunk) => { process.stdout.write(chunk); });
      console.log('\n');
    } catch (err) {
      console.log(chalk.red(`\n❌ Error: ${err.message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

function printHelp() {
  console.log(`
${chalk.bold('Commands:')}
  ${chalk.cyan('/skill')}          — kelola NVIDIA skills (add, list, remove, show)
  ${chalk.cyan('/tree')}           — tampilkan struktur folder project
  ${chalk.cyan('/scan')}           — deep scan ulang project
  ${chalk.cyan('/memory')}         — lihat isi memory sesi ini
  ${chalk.cyan('/reset')}          — hapus memory project ini
  ${chalk.cyan('/help')}           — tampilkan bantuan ini
  ${chalk.cyan('/exit')}           — keluar

${chalk.bold('Skill commands:')}
  ${chalk.yellow('/skill add rag-blueprint')}   — install NVIDIA RAG skill
  ${chalk.yellow('/skill available')}           — lihat semua skill di catalog
  ${chalk.yellow('/skill list')}               — skill yang terinstall

${chalk.bold('Contoh pertanyaan:')}
  ${chalk.gray('→')} "Jelaskan arsitektur project ini"
  ${chalk.gray('→')} "Bagaimana alur autentikasi berjalan?"
  ${chalk.gray('→')} "Review UI/UX halaman checkout"
  ${chalk.gray('→')} "Deploy RAG pipeline untuk project ini"
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});