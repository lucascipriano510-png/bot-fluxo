/**
 * Script de diagnóstico — testa a conexão com o Gemini via REST.
 * Uso: npx ts-node scripts/testGemini.ts
 * Não usa SDK — usa o mesmo padrão REST do leadIntelligence.ts.
 */
import 'dotenv/config';

async function main() {
  const key   = process.env.AI_ASSIST_KEY || process.env.GEMINI_API_KEY || '';
  const model = process.env.AI_ASSIST_MODEL || 'gemini-2.5-flash';

  console.log('=== Diagnóstico Gemini ===');
  console.log('AI_ASSIST_KEY presente:   ', !!process.env.AI_ASSIST_KEY);
  console.log('GEMINI_API_KEY presente:  ', !!process.env.GEMINI_API_KEY);
  console.log('Chave usada (8 chars):    ', key ? key.substring(0, 8) + '...' : 'NENHUMA');
  console.log('Modelo:                   ', model);

  if (!key) {
    console.error('\nERRO: Nenhuma API key encontrada.');
    console.error('Defina AI_ASSIST_KEY ou GEMINI_API_KEY no .env ou no Render.');
    process.exit(1);
  }

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents:         [{ role: 'user', parts: [{ text: 'Responda APENAS com este JSON exato: {"status":"ok","mensagem":"Gemini funcionando"}' }] }],
    generationConfig: { maxOutputTokens: 100, temperature: 0 },
  };

  console.log('\nChamando Gemini...');
  try {
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });

    console.log('HTTP Status:', resp.status, resp.statusText);
    const data = await resp.json();

    if (!resp.ok) {
      console.error('ERRO da API Gemini:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    console.log('Resposta bruta:', text);

    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);
    console.log('\n✅ Gemini OK:', parsed);
  } catch (err) {
    console.error('\nERRO ao chamar Gemini:', err);
    process.exit(1);
  }
}

main();
