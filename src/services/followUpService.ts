/**
 * followUpService — retoma conversas quentes abandonadas (1 follow-up por lead).
 *
 * DESLIGADO por padrão. Só roda quando FOLLOWUP_ATIVO=true no ambiente E o
 * canal real (Baileys) está conectado. Regras de segurança:
 *   - respeita bot_ativo e horário comercial da loja
 *   - respeita opt-out (LGPD) e humano_ativo
 *   - só aborda quem demonstrou interesse (interesse ou nome no contexto)
 *   - envia NO MÁXIMO 1 follow-up por sessão (flag _followup_sent no contexto)
 *   - máximo 5 envios por ciclo de 5 minutos
 */

import { supabase } from '../lib/supabase';
import { getRuntimeSettings } from './settingsService';
import { isBusinessHours } from '../utils/businessHours';
import { isOptedOut } from './optoutService';
import { updateSession } from './sessionService';
import { saveMensagem } from './mensagemService';

const ENABLED       = process.env.FOLLOWUP_ATIVO === 'true';
const MIN_IDLE_MIN  = Number(process.env.FOLLOWUP_MIN_IDLE_MINUTES || 45);
const MAX_IDLE_H    = 24;
const MAX_PER_TICK  = 5;
const TICK_MS       = 5 * 60_000;

type SendFn = (phone: string, text: string) => Promise<void>;

let _timer: NodeJS.Timeout | null = null;

export function startFollowUpLoop(storeId: string, send: SendFn): void {
  if (!ENABLED) return;
  if (_timer) return;
  _timer = setInterval(() => {
    tick(storeId, send).catch(err => console.error('[followup] tick:', (err as Error).message));
  }, TICK_MS);
  console.log(`[followup] ativo — janela ${MIN_IDLE_MIN}min a ${MAX_IDLE_H}h, máx ${MAX_PER_TICK}/ciclo`);
}

export function stopFollowUpLoop(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

async function tick(storeId: string, send: SendFn): Promise<void> {
  const settings = await getRuntimeSettings(storeId);
  if (!settings.bot_ativo || !isBusinessHours(settings)) return;

  const now    = Date.now();
  const newest = new Date(now - MIN_IDLE_MIN * 60_000).toISOString();
  const oldest = new Date(now - MAX_IDLE_H * 3_600_000).toISOString();

  const { data: sessions } = await supabase
    .from('bot_sessions')
    .select('phone, current_node, context, humano_ativo, atualizado_em')
    .eq('store_id', storeId)
    .gt('atualizado_em', oldest)
    .lt('atualizado_em', newest)
    .limit(50);

  let sent = 0;
  for (const s of sessions || []) {
    if (sent >= MAX_PER_TICK) break;

    const ctx = (s.context || {}) as Record<string, string>;
    if (ctx._followup_sent) continue;
    if (s.humano_ativo) continue;

    const interesse = (ctx.interesse || '').trim();
    if (!interesse && !ctx.nome) continue; // só aborda quem já demonstrou algo

    if (await isOptedOut(storeId, s.phone)) continue;

    const nome = ctx.nome ? ` ${ctx.nome.split(' ')[0]}` : '';
    const text = interesse
      ? `Oi${nome}! 👋 Vi que você se interessou por ${interesse} e a conversa ficou pela metade. Ainda posso te ajudar? Se quiser te mando as opções disponíveis 😉`
      : `Oi${nome}! 👋 Nossa conversa ficou pela metade — posso te ajudar em mais alguma coisa?`;

    try {
      await send(s.phone, text);
      ctx._followup_sent = new Date().toISOString();
      await updateSession(storeId, s.phone, s.current_node || 'INICIO', ctx);
      await saveMensagem({ store_id: storeId, phone: s.phone, direcao: 'saida', conteudo: text, node: 'FOLLOWUP' });
      sent++;
    } catch (err) {
      console.error('[followup] envio falhou para', s.phone, '—', (err as Error).message);
    }
  }

  if (sent > 0) console.log(`[followup] ${sent} follow-up(s) enviados`);
}
