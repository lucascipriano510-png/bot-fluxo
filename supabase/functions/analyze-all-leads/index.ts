// Supabase Edge Function — analyze-all-leads
// Fila de análise com orçamento de tempo e auto-continuação.
//
// Por que não é um loop simples com delay:
// 1. Edge Function morre em ~400s de wall clock. Com ~6,5s por lead, a
//    partir de ~45 leads o loop seria morto NO MEIO, sem resposta e sem
//    checkpoint. Aqui a função trabalha até o orçamento (300s) e, se
//    sobrar fila, SE AUTO-INVOCA para a próxima passada — qualquer
//    tamanho de lista termina, em passadas de até 300s.
// 2. Gemini 2.5 Flash free tier = 10 req/min e 250 req/DIA. Reanalisar
//    todo mundo torra a cota diária à toa: só entra na fila quem nunca
//    foi analisado ou mexeu depois da última análise (ai_analisado_em).
// 3. O delay entre chamadas é 6500ms (~9,2 req/min) — 5000ms dava
//    12 req/min, ACIMA do limite de 10: tomaria 429 por matemática.
// 4. 429 agora chega de verdade (analyze-lead propaga em vez de virar
//    500) e é respeitado: usa o Retry-After do Gemini; se 4 tentativas
//    falharem é cota DIÁRIA esgotada — aborta a rodada em vez de
//    martelar o resto da fila contra a mesma parede.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const ORCAMENTO_MS   = 300_000 // teto da plataforma é ~400s; 100s de folga p/ retries em curso
const DELAY_MS       = 6_500   // ~9,2 req/min < 10 req/min do free tier
const MAX_TENTATIVAS = 4       // por lead; falhou tudo = cota diária, aborta a rodada
const MAX_PASSADAS   = 8       // trava anti-loop da auto-continuação

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let storeId: string | undefined
    let passada = 1
    try {
      const body = await req.json().catch(() => ({}))
      storeId = body.storeId
      passada = Math.max(1, Math.min(Number(body.passada) || 1, MAX_PASSADAS))
    } catch (_) {}

    const inicio = Date.now()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    let query = supabase
      .from('bot_leads')
      .select('id, nome, phone, atualizado_em, ai_analisado_em')
    if (storeId) query = query.eq('store_id', storeId)

    const { data: todos, error } = await query.order('atualizado_em', { ascending: false })
    if (error) throw new Error(`Buscar leads: ${JSON.stringify(error)}`)

    // Só quem PRECISA de análise (filtro em JS: PostgREST não compara
    // coluna com coluna): nunca analisado, ou mexeu depois da última análise.
    const fila = (todos ?? []).filter(
      (l) => !l.ai_analisado_em || (l.atualizado_em && l.atualizado_em > l.ai_analisado_em)
    )
    const jaEmDia = (todos?.length ?? 0) - fila.length

    console.log(
      `[AI] ====== PASSADA ${passada}: ${fila.length} na fila | ${jaEmDia} já em dia | ${todos?.length ?? 0} no total ======`
    )

    if (fila.length === 0) {
      return new Response(
        JSON.stringify({ sucesso: 0, erro: 0, pulados: 0, ja_em_dia: jaEmDia, restantes: 0, total: todos?.length ?? 0, passada, continuara: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let sucesso = 0
    let erro = 0
    let pulados = 0 // sem mensagens: analyze-lead pula sem gastar cota
    let cotaEsgotada = false
    let processados = 0

    for (const lead of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        console.log('[AI] Orçamento de tempo esgotado — o resto fica pra próxima passada.')
        break
      }

      processados++
      console.log(`[AI] ${processados}/${fila.length} — ${lead.nome ?? lead.phone}`)

      let tentativas = 0
      while (true) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-lead`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ leadId: lead.id }),
          })

          if (res.status === 429) {
            tentativas++
            if (tentativas >= MAX_TENTATIVAS) {
              // 4 esperas seguidas sem abrir janela = cota DIÁRIA do Gemini.
              // Martelar os outros leads só queima tempo: encerra a rodada.
              console.error('[AI] 429 persistente — cota diária do Gemini esgotada. Abortando a rodada.')
              cotaEsgotada = true
              break
            }
            const retryAfter =
              Number(res.headers.get('retry-after')) || [15, 30, 60][tentativas - 1] || 60
            console.log(`[AI] Rate limit em ${lead.nome ?? lead.id} — aguardando ${retryAfter}s (tentativa ${tentativas}/${MAX_TENTATIVAS})`)
            await sleep(retryAfter * 1000)
            continue
          }

          const data = await res.json().catch(() => null)
          if (res.ok) {
            if (data?.skipped) pulados++
            else sucesso++
          } else {
            console.error(`[AI] Erro ${lead.nome ?? lead.id}: ${JSON.stringify(data)}`)
            erro++
          }
          break
        } catch (e) {
          console.error(`[AI] Exceção ${lead.nome ?? lead.id}:`, e)
          erro++
          break
        }
      }

      if (cotaEsgotada) break
      await sleep(DELAY_MS)
    }

    // Quem não foi resolvido nesta passada (inclui o lead onde a cota estourou)
    const restantes = Math.max(0, fila.length - sucesso - erro - pulados)

    // Auto-continuação: sobrou fila, houve progresso real e não é cota
    // esgotada -> dispara a próxima passada e responde sem esperar por ela.
    let continuara = false
    if (restantes > 0 && !cotaEsgotada && sucesso + pulados > 0 && passada < MAX_PASSADAS) {
      continuara = true
      console.log(`[AI] ${restantes} restantes — disparando passada ${passada + 1}.`)
      fetch(`${SUPABASE_URL}/functions/v1/analyze-all-leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ storeId, passada: passada + 1 }),
      }).catch(() => {})
      await sleep(1_500) // garante que a requisição saiu antes desta instância encerrar
    }

    console.log(
      `[AI] ====== PASSADA ${passada} CONCLUÍDA: ${sucesso} sucesso | ${pulados} pulados | ${erro} erro | ${restantes} restantes${cotaEsgotada ? ' | COTA ESGOTADA' : ''} ======`
    )

    return new Response(
      JSON.stringify({
        sucesso,
        erro,
        pulados,
        ja_em_dia: jaEmDia,
        restantes,
        total: todos?.length ?? 0,
        passada,
        continuara,
        cota_esgotada: cotaEsgotada,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[AI] Erro fatal:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
