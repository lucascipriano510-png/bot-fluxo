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
function isUsable(p) { return p && !/^0+$/.test(p) && p.replace(/\D/g, '').length >= 12; }

(async () => {
  if (!STORE) { console.log('❌ SITE_STORE_ID/STORE_ID não definido no .env'); process.exit(1); }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // Só os que ainda não têm phone_real.
  const { data: leads, error } = await sb
    .from('bot_leads')
    .select('id, phone, phone_real')
    .eq('store_id', STORE)
    .is('phone_real', null);
  if (error) { console.log('ERRO lendo leads:', error.message); process.exit(1); }

  console.log(`Leads sem phone_real: ${leads.length} | modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Busca os mapeamentos reversos em lotes.
  const reverseKey = (lid) => `lid-mapping-${String(lid || '').replace(/\D/g, '')}_reverse`;
  const map = {};
  const keys = leads.map((l) => reverseKey(l.phone));
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const { data } = await sb.from('baileys_auth').select('key,value').eq('store_id', STORE).in('key', batch);
    (data || []).forEach((r) => { map[r.key] = r.value; });
  }

  let resolved = 0, applied = 0, unresolved = 0, invalid = 0;
  for (const l of leads) {
    const raw = map[reverseKey(l.phone)];
    const pn = normalizePhone(typeof raw === 'string' ? raw : '');
    if (!raw) { unresolved++; continue; }
    if (!isUsable(pn)) { invalid++; continue; }
    resolved++;
    if (APPLY) {
      const { error: upErr } = await sb.from('bot_leads').update({ phone_real: pn }).eq('id', l.id).eq('store_id', STORE);
      if (upErr) console.log('  erro update', l.id, upErr.message); else applied++;
    }
  }

  console.log(`Resolvíveis: ${resolved} | aplicados: ${applied} | sem mapeamento: ${unresolved} | inválidos: ${invalid}`);
  if (!APPLY) console.log('→ Rode com "apply" para gravar.');
})().catch((e) => console.log('EXC:', e.message));
