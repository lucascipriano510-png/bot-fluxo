// Supabase Edge Function — analyze-all-leads
// Processa todos os leads da loja chamando analyze-lead para cada um.
// Roda na infraestrutura Supabase, independente do Render.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Aceita storeId opcional no body para filtrar por loja
    let storeId: string | undefined
    try {
      const body = await req.json().catch(() => ({}))
      storeId = body.storeId
    } catch (_) {}

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    let query = supabase.from('bot_leads').select('id, nome, phone')
    if (storeId) query = query.eq('store_id', storeId)

    const { data: leads, error } = await query.order('atualizado_em', { ascending: false })

    if (error) throw new Error(`Buscar leads: ${JSON.stringify(error)}`)

    if (!leads?.length) {
      console.log('[AI] Nenhum lead encontrado.')
      return new Response(
        JSON.stringify({ sucesso: 0, erro: 0, total: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[AI] ====== INICIANDO ANÁLISE EM LOTE: ${leads.length} leads ======`)

    let sucesso = 0
    let erro = 0

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      console.log(`[AI] ${i + 1}/${leads.length} — ${lead.nome ?? lead.phone}`)

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-lead`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ leadId: lead.id }),
        })

        if (res.ok) {
          sucesso++
        } else {
          const errText = await res.text()
          console.error(`[AI] Erro ${lead.nome ?? lead.id}: ${errText}`)
          erro++
        }
      } catch (e) {
        erro++
        console.error(`[AI] Exceção ${lead.nome ?? lead.id}:`, e)
      }

      // 2s entre chamadas para respeitar rate limit do Gemini free tier
      if (i < leads.length - 1) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    console.log(`[AI] ====== CONCLUÍDO: ${sucesso} sucesso | ${erro} erro ======`)

    return new Response(
      JSON.stringify({ sucesso, erro, total: leads.length }),
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
