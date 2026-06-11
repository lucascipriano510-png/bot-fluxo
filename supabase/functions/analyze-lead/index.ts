// Supabase Edge Function — analyze-lead
// Analisa um lead individual via Gemini e salva no Supabase.
// Roda na infraestrutura Supabase, independente do Render.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY      = Deno.env.get('GEMINI_API_KEY') ?? ''
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const KANBAN_MAP: Record<string, string> = {
  'novo lead': 'novo', 'new lead': 'novo', 'novo': 'novo',
  'interessado': 'interessado',
  'escolhendo': 'escolhendo',
  'carrinho montado': 'carrinho', 'carrinho': 'carrinho',
  'aguardando pgto': 'pagamento', 'pagamento': 'pagamento',
  'fechado': 'finalizado', 'finalizado': 'finalizado',
  'perdido': 'novo',
}

const STATUS_MAP: Record<string, string> = {
  quente: 'QUENTE', morno: 'MORNO', frio: 'FRIO',
}

const SALES_BRAIN = `
Você é um especialista sênior em vendas pelo WhatsApp para lojas de moda e
streetwear brasileiras. Você analisou mais de 500.000 conversas de WhatsApp
de e-commerce de moda no Brasil e conhece com precisão os padrões de
comportamento de compra do consumidor brasileiro.

Sua missão é analisar conversas de WhatsApp e classificar o estágio de compra
do lead com máxima precisão.

FUNIL DE COMPRA NO WHATSAPP BRASILEIRO DE MODA

ESTÁGIO 1 — PRIMEIRO CONTATO (score 5-15): "Oi", "Bom dia", saudações simples.
ESTÁGIO 2 — RECONHECIMENTO DE ANÚNCIO (score 25-40): "Vi seu anúncio", "Vi no Instagram", "Vi no stories", "Caiu no meu feed". LEAD QUENTE.
ESTÁGIO 3 — PESQUISA DE PRODUTO (score 40-60): "Tem camiseta do [time]?", "Tem no GG?", "Manda o catálogo", "Tem na cor [cor]?". INTERESSE REAL.
ESTÁGIO 4 — AVALIAÇÃO DE PREÇO (score 55-75): "Quanto custa?", "Quanto fica o frete?", "Tem desconto?", "Aceita pix?".
ESTÁGIO 5 — INTENÇÃO DE COMPRA (score 75-90): "Quero comprar", "Manda o pix", "Chave pix?", "Reserva pra mim?". FECHAR AGORA.
ESTÁGIO 6 — FECHAMENTO (score 90-100): "Mandei o pix", "Já paguei", "Quando chega?".

GATILHOS DE INTERESSE ALTO (score mínimo 60):
- Time de futebol + produto: "Tem camiseta do Flamengo no GG?" = score 65+
- "Vi seu anúncio" = score 60+
- "Manda o pix" = score 85+
- "Quanto fica o frete pro Ceará?" = score 55+

SINAIS DE ABANDONO: "Vou ver depois", "Tá caro", conversa parada >48h = frio.

REGRA DE OURO: Uma mensagem com gatilho forte vale mais que 10 mensagens neutras.
`

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { leadId } = await req.json()
    if (!leadId) {
      return new Response(JSON.stringify({ error: 'leadId obrigatório' }), { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 1. Buscar lead
    const { data: lead, error: leadErr } = await supabase
      .from('bot_leads')
      .select('id, phone, store_id, nome')
      .eq('id', leadId)
      .single()

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead não encontrado', detail: leadErr }), { status: 404, headers: corsHeaders })
    }

    // 2. Buscar mensagens (wa_messages por lead_id, fallback por phone)
    let msgs: Array<{ direction: string; text: string; timestamp?: string }> = []

    const { data: waMsgs } = await supabase
      .from('wa_messages')
      .select('direction, text, timestamp')
      .eq('lead_id', leadId)
      .order('timestamp', { ascending: true })
      .limit(30)

    msgs = waMsgs ?? []

    if (msgs.length === 0) {
      const { data: waMsgsByPhone } = await supabase
        .from('wa_messages')
        .select('direction, text, timestamp')
        .eq('store_id', lead.store_id)
        .eq('phone', lead.phone)
        .order('timestamp', { ascending: true })
        .limit(30)
      msgs = waMsgsByPhone ?? []
    }

    // Fallback: bot_mensagens
    if (msgs.length === 0) {
      const { data: botMsgs } = await supabase
        .from('bot_mensagens')
        .select('direcao, conteudo, criado_em')
        .eq('phone', lead.phone)
        .eq('store_id', lead.store_id)
        .order('criado_em', { ascending: true })
        .limit(30)
      msgs = (botMsgs ?? []).map(m => ({
        direction: m.direcao === 'saida' ? 'out' : 'in',
        text: m.conteudo,
        timestamp: m.criado_em,
      }))
    }

    // 3. Calcular horas desde última mensagem do cliente
    const ultimaDoCliente = [...msgs]
      .filter(m => m.direction === 'in' && m.timestamp)
      .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())[0]

    const horasDesde = ultimaDoCliente?.timestamp
      ? Math.floor((Date.now() - new Date(ultimaDoCliente.timestamp).getTime()) / 3_600_000)
      : 999

    // 4. Montar conversa
    const conversa = msgs.length > 0
      ? msgs.map(m => `${m.direction === 'out' ? 'Loja' : 'Cliente'}: ${m.text}`).join('\n')
      : `Cliente: sem mensagens registradas`

    // 5. Chamar Gemini REST
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), { status: 500, headers: corsHeaders })
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SALES_BRAIN}

TAREFA: Analise esta conversa de WhatsApp de loja de moda brasileira.
Retorne SOMENTE JSON válido. Sem markdown. Sem texto extra.

CONVERSA:
${conversa}

HORAS DESDE ÚLTIMA MENSAGEM DO CLIENTE: ${horasDesde}h

RETORNE EXATAMENTE ESTE JSON (sem blocos de código):
{"temperatura":"frio","score":0,"resumo":"max 80 chars","proxima_acao":"max 60 chars","intencao_principal":"primeiro_contato","kanban_coluna_sugerida":"novo","urgencia":"baixa","confianca":0.5}

Valores de temperatura: quente, morno, frio
Valores de kanban_coluna_sugerida: novo, interessado, escolhendo, carrinho, pagamento, finalizado
Valores de intencao_principal: primeiro_contato, reconhecimento_anuncio, pesquisa_produto, avaliacao_preco, intencao_compra, fechamento, abandono, reclamacao, retorno
Valores de urgencia: alta, media, baixa` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json' },
        }),
      }
    )

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      throw new Error(`Gemini HTTP ${geminiRes.status}: ${errText}`)
    }

    const geminiData = await geminiRes.json()
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    if (!rawText) throw new Error(`Gemini sem resposta: ${JSON.stringify(geminiData)}`)

    // 6. Parse com fallback para JSON truncado
    let jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    if (!jsonStr.endsWith('}')) {
      const last = jsonStr.lastIndexOf('",')
      jsonStr = last > 0 ? jsonStr.substring(0, last + 1) + '}' : jsonStr + '"}'
    }

    const parsed = JSON.parse(jsonStr)
    const temperatura = ['quente', 'morno', 'frio'].includes(parsed.temperatura) ? parsed.temperatura : 'frio'
    const kanban = KANBAN_MAP[parsed.kanban_coluna_sugerida?.toLowerCase()?.trim()] ?? 'novo'

    // 7. Salvar no Supabase
    const { error: updateErr } = await supabase
      .from('bot_leads')
      .update({
        ai_score:           Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        ai_resumo:          parsed.resumo          || 'Análise concluída.',
        ai_intencao:        parsed.intencao_principal || 'primeiro_contato',
        ai_proxima_acao:    parsed.proxima_acao     || 'Manter contato.',
        ai_temperatura:     temperatura,
        ai_kanban_sugerida: kanban,
        ai_urgencia:        ['alta','media','baixa'].includes(parsed.urgencia) ? parsed.urgencia : 'baixa',
        ai_confianca:       Math.max(0, Math.min(1, Number(parsed.confianca) || 0.5)),
        ai_analisado_em:    new Date().toISOString(),
        status_comercial:   STATUS_MAP[temperatura] ?? 'FRIO',
        kanban_stage:       kanban,
      })
      .eq('id', leadId)

    if (updateErr) throw new Error(`Supabase update: ${JSON.stringify(updateErr)}`)

    console.log(`[AI] Lead ${lead.nome}: ${temperatura} | score ${parsed.score}`)

    return new Response(
      JSON.stringify({ success: true, leadId, temperatura, score: parsed.score, kanban }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[AI] Erro:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
