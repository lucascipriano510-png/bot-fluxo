#!/usr/bin/env node
/**
 * safe-ship — build + commit + push com verificação de arquivos sensíveis.
 * Uso: npm run safe-ship -- "mensagem do commit"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Padrões de caminho bloqueados ───────────────────────────────────────────
const BLOCKED_PATH_PATTERNS = [
  /^\.env(\.local|\.production|\.staging)?$/i,
  /supabase\//i,
  /migrations?\//i,
  /(^|\/)rls[^/]*$/i,
  /invite_codes/i,
  /webhook.*secret/i,
];

// ── Strings bloqueadas no conteúdo do diff ─────────────────────────────────
const BLOCKED_CONTENT_STRINGS = [
  'SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'postgresql://',
  'SUPABASE_SERVICE_ROLE',
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
}

function runInherit(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function abort(msg) {
  console.error(`\n🚫 ABORTADO: ${msg}\n`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const message = process.argv.slice(2).join(' ').trim();
  if (!message) {
    abort('Forneça a mensagem do commit.\n   Uso: npm run safe-ship -- "mensagem do commit"');
  }

  console.log('\n🚢  Safe Ship iniciado...\n');

  // 1. Verificar arquivos alterados
  const statusRaw = run('git status --porcelain');
  if (!statusRaw) {
    console.log('✅ Nada para commitar. Working tree limpo.');
    process.exit(0);
  }

  const changedFiles = statusRaw
    .split('\n')
    .map(l => l.slice(3).trim())   // remove status prefix (XY + space)
    .filter(Boolean);

  console.log(`📂 Arquivos alterados (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`   ${f}`));

  // 2. Verificar padrões de caminho bloqueados
  const blockedPaths = [];
  for (const file of changedFiles) {
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(file)) {
        blockedPaths.push(`  ⛔ ${file}  (padrão: ${pattern})`);
        break;
      }
    }
  }

  if (blockedPaths.length > 0) {
    console.error('\n🚫 Arquivos sensíveis detectados — commit bloqueado:');
    blockedPaths.forEach(b => console.error(b));
    abort('Revise os arquivos acima antes de usar safe-ship.');
  }

  // 3. Verificar conteúdo do diff por strings sensíveis
  let diff = '';
  try { diff = run('git diff HEAD'); } catch (_) {}
  try { diff += run('git diff --cached'); } catch (_) {}

  const blockedContent = BLOCKED_CONTENT_STRINGS.filter(s => diff.includes(s));
  if (blockedContent.length > 0) {
    console.error('\n🚫 Conteúdo sensível detectado no diff:');
    blockedContent.forEach(s => console.error(`  ⛔ "${s}"`));
    abort('Remova as informações sensíveis antes de usar safe-ship.');
  }

  console.log('\n✅ Nenhum arquivo ou conteúdo sensível detectado.\n');

  // 4. Build
  console.log('🔨 Rodando build...\n');
  try {
    runInherit('npm run build');
    console.log('\n✅ Build passou.\n');
  } catch (_) {
    abort('Build falhou. Corrija os erros antes de commitar.');
  }

  // 5. Commit (mensagem via arquivo temporário para evitar problemas de escape)
  console.log('📝 Criando commit...');
  const tmpMsg = path.join('.git', 'SAFE_SHIP_MSG');
  fs.writeFileSync(
    tmpMsg,
    `${message}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`,
    'utf8',
  );
  try {
    run('git add -A');
    run(`git commit -F "${tmpMsg}"`);
  } catch (e) {
    fs.unlinkSync(tmpMsg);
    abort(`Falha no commit: ${e.message}`);
  }
  fs.unlinkSync(tmpMsg);

  const commitHash = run('git rev-parse --short HEAD');
  console.log(`✅ Commit criado: ${commitHash} — ${message}\n`);

  // 6. Push
  console.log('🚀 Enviando para o repositório...');
  const branch = run('git rev-parse --abbrev-ref HEAD');
  try {
    runInherit(`git push origin ${branch}`);
  } catch (_) {
    abort('Push falhou. Verifique sua conexão ou permissões.');
  }

  // 7. Resumo
  console.log('\n✨ Safe Ship concluído!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔖 Commit : ${commitHash} — ${message}`);
  console.log(`🌿 Branch : ${branch}`);
  console.log(`📂 Arquivos (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`   ${f}`));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main();
