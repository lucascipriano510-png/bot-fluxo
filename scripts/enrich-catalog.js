// ═══════════════════════════════════════════════════════════════════════════
//  enrich-catalog.js — Enriquecimento do catálogo por VISÃO (Gemini).
//  Lê a foto de cada produto e sugere { cor, tipo, descricao, tags }.
//
//  À PROVA DE LIMITE DE API:
//   - Resumível: grava cada resultado em scripts/enrich-suggestions.json na hora.
//     Se parar no meio, rodar de novo CONTINUA de onde parou (pula os já feitos).
//   - Throttle entre chamadas (respeita RPM do free tier).
//   - Backoff em 429/quota; se a cota esgotar, PARA limpo e reporta o progresso.
//   - MODO SUGESTÃO: não escreve no catálogo (products). Só no JSON local.
//
//  Uso:
//    node scripts/enrich-catalog.js            # processa todos os pendentes
//    node scripts/enrich-catalog.js 15         # processa só os próximos 15 (lote)
// ═══════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const LIMIT = Number(process.argv[2]) || Infinity;
const KEY = process.env.GEMINI_API_KEY || process.env.AI_ASSIST_KEY;
// Modelo do enriquecimento (separado do bot). 2.0-flash tem free tier bem maior
// que o 2.5-flash, com a mesma capacidade de visão. Override via ENRICH_MODEL.
const MODEL = process.env.ENRICH_MODEL || 'gemini-2.0-flash';
const THROTTLE_MS = Number(process.env.ENRICH_THROTTLE_MS) || 4500; // ~13 req/min
const OUT = path.join(__dirname, 'enrich-suggestions.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!KEY) {
  console.log('❌ Sem chave do Gemini. Defina AI_ASSIST_KEY (ou GEMINI_API_KEY) no .env local.');
  process.exit(1);
}

const site = createClient(process.env.SITE_SUPABASE_URL, process.env.SITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

function loadDone() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return {}; }
}
function saveOne(map, id, obj) {
  map[id] = obj;
  fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
}

async function fetchImageB64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`img HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get('content-type') || 'image/jpeg';
  return { data: buf.toString('base64'), mime };
}

const PROMPT = `Você analisa a FOTO de uma peça de roupa/produto de uma loja.
Responda SOMENTE um JSON válido, sem texto extra, no formato:
{"cor":"<cor principal em pt-br: preto|branco|azul|vermelho|verde|amarelo|cinza|bege|marrom|rosa|roxo|laranja|estampado>","tipo":"<ex: camiseta, polo, calça, tênis, chinelo>","descricao":"<1 frase curta e vendedora>","tags":["3 a 6 palavras-chave de busca em pt-br"]}`;

// Retorna {ok, data?, rateLimited?, error?}
async function callVision(b64, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: 'application/json' },
  };
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { return { ok: false, error: 'network: ' + e.message }; }
  const j = await r.json().catch(() => null);
  if (r.status === 429 || !r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    // Cota real esgotada → parar a rodada. Transitório (sobrecarga/503) → re-tentar.
    const quota     = /quota|exhausted|billing|per day|daily limit/i.test(msg) || (r.status === 429 && /quota|exhausted/i.test(msg));
    const transient = !quota && (/high demand|overloaded|try again later|unavailable|temporar|deadline|500|502|503/i.test(msg) || r.status >= 500 || r.status === 429);
    const m = msg.match(/retry in ([\d.]+)s/i);
    const retryAfterMs = m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
    return { ok: false, rateLimited: quota, transient, retryAfterMs, error: msg };
  }
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: 'sem JSON na resposta' };
  try { return { ok: true, data: JSON.parse(m[0]) }; } catch { return { ok: false, error: 'JSON inválido' }; }
}

(async () => {
  const { data: products, error } = await site
    .from('products')
    .select('id,name,subcategory,category,color,image,image_url')
    .order('id');
  if (error) { console.log('ERRO lendo products:', error.message); process.exit(1); }

  const done = loadDone();
  const pending = products.filter((p) => !done[p.id] && (p.image || p.image_url));
  console.log(`Catálogo: ${products.length} | já enriquecidos: ${Object.keys(done).length} | pendentes: ${pending.length} | lote: ${LIMIT === Infinity ? 'todos' : LIMIT}`);

  let okCount = 0, errCount = 0, processed = 0;
  let quotaPauses = 0;
  const MAX_QUOTA_PAUSES = 60; // ~auto-pausas no limite por minuto antes de desistir
  for (const p of pending) {
    if (processed >= LIMIT) break;
    processed++;
    const tag = `[${Object.keys(done).length + 1}/${products.length}] ${p.subcategory || p.category || p.name}`;

    let img;
    try { img = await fetchImageB64(p.image || p.image_url); }
    catch (e) { console.log(`  ⚠️ ${tag}: falha ao baixar imagem (${e.message}) — pulado`); errCount++; continue; }

    // Re-tentativas: cota real → backoff longo e PARA a rodada; transitório
    // (sobrecarga/503) → backoff curto e, se persistir, pula (fica pendente).
    const transientWaits = [5000, 12000, 25000];
    let res, tAttempt = 0;
    while (true) {
      res = await callVision(img.data, img.mime);
      if (res.ok) break;
      if (res.rateLimited) {
        // Limite por minuto: espera o tempo que a própria API pede e RETOMA o mesmo item.
        const ra = res.retryAfterMs && res.retryAfterMs <= 120000 ? res.retryAfterMs : 45000;
        if (quotaPauses >= MAX_QUOTA_PAUSES) {
          console.log(`\n🛑 Cota persistente — parando em ${Object.keys(done).length}/${products.length}. Rode de novo depois (continua de onde parou).`);
          process.exit(0);
        }
        quotaPauses++;
        await sleep(ra + 3000); continue;
      }
      if (res.transient) {
        if (tAttempt >= transientWaits.length) break; // desiste deste; fica pendente
        await sleep(transientWaits[tAttempt]); tAttempt++; continue;
      }
      break; // erro não recuperável → pula
    }

    if (res.ok) {
      saveOne(done, p.id, { sub: p.subcategory, color_atual: p.color, ...res.data });
      okCount++;
      console.log(`  ✅ ${tag}: cor=${res.data.cor} tipo=${res.data.tipo}`);
    } else {
      errCount++;
      console.log(`  ⚠️ ${tag}: ${res.error}`);
    }
    await sleep(THROTTLE_MS);
  }

  console.log(`\nConcluído este lote. ✅ ${okCount} | ⚠️ ${errCount} | total enriquecidos: ${Object.keys(done).length}/${products.length}`);
  console.log(`Sugestões em: ${OUT} (modo sugestão — nada foi gravado no catálogo).`);
})().catch((e) => console.log('EXC:', e.message));
