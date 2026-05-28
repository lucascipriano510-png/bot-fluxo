#!/usr/bin/env node
/**
 * check-sensitive-files — verifica arquivos modificados e conteúdo sensível.
 * Uso: npm run check:sensitive
 * Retorna exit 0 se seguro, exit 1 se risco detectado.
 */

const { execSync } = require('child_process');

const BLOCKED_PATH_PATTERNS = [
  { pattern: /^\.env(\.local|\.production|\.staging)?$/i, label: '.env / .env.local' },
  { pattern: /supabase\//i,                                label: 'supabase/' },
  { pattern: /migrations?\//i,                             label: 'migrations/' },
  { pattern: /(^|\/)rls[^/]*$/i,                           label: 'RLS' },
  { pattern: /invite_codes/i,                              label: 'invite_codes' },
  { pattern: /webhook.*secret/i,                           label: 'webhook secret' },
  { pattern: /auth\.(ts|js|sql)$/i,                        label: 'auth file' },
];

const BLOCKED_CONTENT_STRINGS = [
  { str: 'SERVICE_ROLE_KEY',       label: 'SERVICE_ROLE_KEY' },
  { str: 'DATABASE_URL',           label: 'DATABASE_URL' },
  { str: 'postgresql://',          label: 'postgresql://' },
  { str: 'SUPABASE_SERVICE_ROLE',  label: 'SUPABASE_SERVICE_ROLE' },
  { str: 'eyJhbGci',               label: 'JWT token (possível chave Supabase)' },
];

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch (_) { return ''; }
}

function main() {
  console.log('\n🔍 Verificando arquivos e conteúdo sensível...\n');

  const statusRaw = run('git status --porcelain');
  if (!statusRaw) {
    console.log('✅ Working tree limpo. Nada a verificar.\n');
    process.exit(0);
  }

  const changedFiles = statusRaw
    .split('\n')
    .map(l => l.slice(3).trim())
    .filter(Boolean);

  console.log(`📂 Arquivos no escopo (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`   ${f}`));
  console.log('');

  const risks = [];

  // Verificar caminhos
  for (const file of changedFiles) {
    for (const { pattern, label } of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(file)) {
        risks.push(`Caminho sensível: ${file}  [${label}]`);
        break;
      }
    }
  }

  // Verificar conteúdo do diff
  const diff = run('git diff HEAD') + run('git diff --cached');
  for (const { str, label } of BLOCKED_CONTENT_STRINGS) {
    if (diff.includes(str)) {
      risks.push(`Conteúdo sensível no diff: "${str}"  [${label}]`);
    }
  }

  if (risks.length > 0) {
    console.error('🚫 RISCOS DETECTADOS:\n');
    risks.forEach(r => console.error(`  ⛔ ${r}`));
    console.error('\nResolva os problemas acima antes de continuar.\n');
    process.exit(1);
  }

  console.log('✅ Nenhum arquivo ou conteúdo sensível detectado. Seguro para prosseguir.\n');
  process.exit(0);
}

main();
