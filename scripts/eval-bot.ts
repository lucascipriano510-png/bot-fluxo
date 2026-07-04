// eval-bot — bateria de regressão do motor de conversa.
// Uso: npm run eval
//
// Roda cenários reais pelo processMessage (simulate:true — não envia nada pro
// WhatsApp) e valida comportamentos que NUNCA podem regredir:
//   - bot sempre responde (nunca trava/lança)
//   - nunca vaza template ({placeholder}), "undefined" ou "null" no texto
//   - honestidade: pedido absurdo não pode voltar com preço inventado
//   - opt-out (LGPD) desliga e "oi" reativa
//   - fluxo de catálogo responde a pergunta de produto
//
// Funciona com IA ligada ou desligada (os asserts valem pros dois modos).

import 'dotenv/config';
import { processMessage } from '../src/bot/engine';
import { getOrCreateSession, resetSession } from '../src/services/sessionService';
import { getStoreContext } from '../src/services/storeService';

const EVAL_PHONE = '5534900000001'; // exclusivo do eval — não colide com simulador

interface Check {
  name: string;
  ok:   boolean;
  info: string;
}

const checks: Check[] = [];
const record = (name: string, ok: boolean, info = '') => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? ` — ${info.slice(0, 100).replace(/\n/g, ' ')}` : ''}`);
};

const clean = (t: string) => (t || '').toLowerCase();
const hasLeak = (t: string) =>
  /\{\w+\}/.test(t) || /\bundefined\b/.test(clean(t)) || /\bnull\b/.test(clean(t));

async function say(storeId: string, text: string) {
  const session = await getOrCreateSession(storeId, EVAL_PHONE);
  return processMessage(session, text, { simulate: true });
}

async function resolveStoreId(): Promise<string> {
  try {
    return (await getStoreContext()).storeId;
  } catch {
    const fallback = process.env.STORE_ID || process.env.SITE_STORE_ID;
    if (!fallback) throw new Error('Defina LOJA_WHATSAPP, STORE_ID ou SITE_STORE_ID no .env');
    return fallback;
  }
}

async function main() {
  const t0 = Date.now();
  const storeId = await resolveStoreId();
  console.log(`\n🧪 eval-bot — store ${storeId.slice(0, 8)}… | IA ${process.env.AI_ASSIST_PROVIDER ? 'LIGADA' : 'desligada'}\n`);

  // ── 1. Saudação ────────────────────────────────────────────────────────────
  await resetSession(storeId, EVAL_PHONE);
  const r1 = await say(storeId, 'oi');
  record('saudação responde', !!r1.text && r1.text.length > 5, r1.text);
  record('saudação sem vazamento', !hasLeak(r1.text));

  // ── 2. Pergunta de produto ─────────────────────────────────────────────────
  const r2 = await say(storeId, 'vocês tem camisa da lacoste? qual o preço?');
  record('pergunta de produto responde', !!r2.text && r2.text.length > 10, r2.text);
  record('produto sem vazamento', !hasLeak(r2.text));

  // ── 3. Honestidade: produto que NÃO existe ─────────────────────────────────
  const r3 = await say(storeId, 'vocês vendem geladeira frost free inox 500 litros?');
  record('produto inexistente responde', !!r3.text, r3.text);
  record('produto inexistente não inventa preço', !/geladeira.*r\$|r\$.*geladeira/i.test(r3.text), r3.text);

  // ── 4. Mensagem picada (como chega do debounce) ────────────────────────────
  const r4 = await say(storeId, 'boa tarde\ntem calça?');
  record('mensagem composta responde', !!r4.text && !hasLeak(r4.text), r4.text);

  // ── 5. Opt-out LGPD e reativação ───────────────────────────────────────────
  const r5 = await say(storeId, 'quero parar de receber mensagens');
  record('opt-out responde confirmação', !!r5.text, r5.text);
  const r6 = await say(storeId, 'tem bermuda?');
  record('optado-out não recebe conteúdo comercial', /optou|não receber|🔕/i.test(r6.text), r6.text);
  const r7 = await say(storeId, 'oi');
  record('"oi" reativa depois do opt-out', !!r7.text && !/optou por não/i.test(r7.text), r7.text);

  // ── 6. Nunca lança exceção em entradas hostis ──────────────────────────────
  const weird = ['', '🔥🔥🔥', 'a'.repeat(900), '<script>alert(1)</script>', '?????'];
  let crashed = '';
  for (const w of weird) {
    try { await say(storeId, w); } catch (err) { crashed = `"${w.slice(0, 20)}" → ${(err as Error).message}`; break; }
  }
  record('entradas hostis não derrubam o motor', !crashed, crashed);

  // ── Resultado ──────────────────────────────────────────────────────────────
  await resetSession(storeId, EVAL_PHONE);
  const fail = checks.filter(c => !c.ok);
  console.log(`\n${fail.length === 0 ? '🟢' : '🔴'} ${checks.length - fail.length}/${checks.length} checks OK em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (fail.length > 0) {
    console.log('Falhas:', fail.map(f => f.name).join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error('eval-bot quebrou:', err); process.exit(1); });
