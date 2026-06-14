// ═══════════════════════════════════════════════════════════════════════════
//  backfill-phone-real.js
//  Preenche bot_leads.phone_real dos leads ANTIGOS de WhatsApp.
//
//  O WhatsApp endereça por LID (número oculto): bot_leads.phone guarda o LID.
//  O telefone real (PN) está no mapeamento reverso que o Baileys persiste em
//  baileys_auth com key = 'lid-mapping-<LID>_reverse' e value = <PN>.
//
//  Uso:
//    node scripts/backfill-phone-real.js          # dry-run (só relatório)
//    node scripts/backfill-phone-real.js apply     # aplica as atualizações
// ═══════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('apply');
const STORE = process.env.SITE_STORE_ID || process.env.STORE_ID;

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) return '55' + d;
  return d;
}
// Canonicaliza celular BR para 13 dígitos COM o 9º dígito (formato WhatsApp/Meta).
function canonicalMobileBR(raw) {
  const d = normalizePhone(raw);
  if (d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const sub = d.slice(4);
    if (sub.length === 8) return '55' + ddd + '9' + sub;
  }
  return d;
}
function isUsable(p) { return p && !/^0+$/.test(p) && p.replace(/\D/g, '').length >= 12; }

(async () => {
  if (!STORE) { console.log('❌ SITE_STORE_ID/STORE_ID não definido no .env'); process.exit(1); }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // Todos os leads — corrige nulos (via mapeamento) E os já gravados sem o 9º dígito.
  const { data: leads, error } = await sb
    .from('bot_leads')
    .select('id, phone, phone_real')
    .eq('store_id', STORE);
  if (error) { console.log('ERRO lendo leads:', error.message); process.exit(1); }

  console.log(`Leads: ${leads.length} | modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Busca os mapeamentos reversos (LID→PN) em lotes, só p/ quem ainda não tem phone_real.
  const reverseKey = (lid) => `lid-mapping-${String(lid || '').replace(/\D/g, '')}_reverse`;
  const map = {};
  const keys = leads.filter((l) => !l.phone_real).map((l) => reverseKey(l.phone));
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    if (!batch.length) break;
    const { data } = await sb.from('baileys_auth').select('key,value').eq('store_id', STORE).in('key', batch);
    (data || []).forEach((r) => { map[r.key] = r.value; });
  }

  let updated = 0, alreadyOk = 0, unresolved = 0, invalid = 0;
  for (const l of leads) {
    // Fonte do número: phone_real existente (re-canonicaliza) ou o mapeamento reverso.
    const source = l.phone_real || (typeof map[reverseKey(l.phone)] === 'string' ? map[reverseKey(l.phone)] : '');
    if (!source) { unresolved++; continue; }
    const target = canonicalMobileBR(source);
    if (!isUsable(target)) { invalid++; continue; }
    if (target === l.phone_real) { alreadyOk++; continue; }
    if (APPLY) {
      const { error: upErr } = await sb.from('bot_leads').update({ phone_real: target }).eq('id', l.id).eq('store_id', STORE);
      if (upErr) { console.log('  erro update', l.id, upErr.message); continue; }
    }
    updated++;
  }

  console.log(`A atualizar: ${updated} | já corretos: ${alreadyOk} | sem mapeamento: ${unresolved} | inválidos: ${invalid}`);
  if (!APPLY) console.log('→ Rode com "apply" para gravar.');
})().catch((e) => console.log('EXC:', e.message));
