// baileys.ts — Real quando ENABLE_BAILEYS=true (Render/Railway/VPS).
// Sem a variável, retorna stub 'unavailable' (compatível com Vercel serverless).
//
// MODO OBSERVADOR por padrão — nunca responde automaticamente.
// AUTO-RESPOSTA é opt-in: exige BOT_AUTO_REPLY=true no ambiente. Mesmo ligada,
// o engine ainda respeita bot_ativo, humano_ativo, opt-out e horário comercial.
// Pipeline da auto-resposta: debounce 5s (junta mensagens picadas) → engine →
// "digitando..." proporcional → envio. Áudios são transcritos via Gemini.

import { supabase } from '../lib/supabase';
import qrcode from 'qrcode';
import { normalizePhone, canonicalMobileBR } from '../utils/phone';
import { processMessage } from '../bot/engine';
import { getOrCreateSession } from '../services/sessionService';
import { transcribeAudio, describeImage } from '../services/aiAssistService';
import { getRuntimeSettings } from '../services/settingsService';
import { startFollowUpLoop } from '../services/followUpService';
import { setHandoffNotifier } from '../services/handoffBus';

export type WaStatus = 'connected' | 'qr_pending' | 'disconnected' | 'unavailable';

const ENABLED    = process.env.ENABLE_BAILEYS === 'true';
const AUTO_REPLY = process.env.BOT_AUTO_REPLY === 'true';

// Escritas no Supabase antes eram fire-and-forget silenciosas (.then(null,()=>{})),
// então mensagem/conversa podia não persistir sem nenhum rastro. Agora loga a falha.
const logWrite = (tag: string) => (e: unknown) =>
  console.warn(`[wa-persist] falha ao gravar ${tag}:`, (e as Error)?.message || e);

let _status: WaStatus = ENABLED ? 'disconnected' : 'unavailable';
let _qr: string | null = null;
let _socket: any = null;
let _initializing = false;
let _disconnectedAt: Date | null = null;

const silentLogger = {
  level: 'silent' as const,
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {},
  error: console.error, fatal: console.error,
  child() { return this; },
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    const f = num.length === 9
      ? `${num.slice(0, 5)}-${num.slice(5)}`
      : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `+55 (${ddd}) ${f}`;
  }
  return digits ? `+${digits}` : raw;
}

// Resolve o TELEFONE REAL (PN) a partir da mensagem, mesmo quando o WhatsApp
// endereça por LID (remoteJid termina em @lid e esconde o número).
//   1) Se remoteJid já é @s.whatsapp.net → é o próprio número.
//   2) Se é @lid → usa remoteJidAlt (o JID de telefone que o servidor manda junto).
//   3) Fallback → consulta o mapeamento LID→PN do Baileys.
// Retorna dígitos normalizados (55+DDD+número) ou null se não conseguir resolver.
async function resolvePhoneReal(msg: any): Promise<string | null> {
  try {
    const jid: string = msg?.key?.remoteJid || '';
    if (!jid) return null;
    if (jid.endsWith('@s.whatsapp.net')) return canonicalMobileBR(jid);

    if (jid.endsWith('@lid')) {
      const alt: string = msg?.key?.remoteJidAlt || '';
      if (alt.endsWith('@s.whatsapp.net')) return canonicalMobileBR(alt);

      const pnJid: string | null = await _socket?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pnJid && pnJid.endsWith('@s.whatsapp.net')) return canonicalMobileBR(pnJid);
    }
  } catch (err) {
    console.warn('[Baileys] resolvePhoneReal falhou:', (err as Error)?.message);
  }
  return null;
}

// ── Auto-resposta: buffer de mensagens picadas (debounce por telefone) ──────
// Cliente de WhatsApp digita em rajada ("oi" / "tem calça?" / "jogador").
// Espera 5s de silêncio (máx 15s desde a primeira) e processa tudo junto:
// uma chamada ao engine, uma resposta natural, menos custo de IA.
const DEBOUNCE_MS   = 5_000;
const MAX_BUFFER_MS = 15_000;
const _pending = new Map<string, { jid: string; texts: string[]; timer: NodeJS.Timeout; firstAt: number }>();

function queueAutoReply(storeId: string, phone: string, jid: string, text: string): void {
  const entry = _pending.get(phone);
  if (entry) {
    entry.texts.push(text);
    clearTimeout(entry.timer);
    const remaining = Math.max(500, MAX_BUFFER_MS - (Date.now() - entry.firstAt));
    entry.timer = setTimeout(() => flushAutoReply(storeId, phone), Math.min(DEBOUNCE_MS, remaining));
  } else {
    _pending.set(phone, {
      jid,
      texts:   [text],
      firstAt: Date.now(),
      timer:   setTimeout(() => flushAutoReply(storeId, phone), DEBOUNCE_MS),
    });
  }
}

// Operador respondeu manualmente pelo celular → bot não atropela
function cancelAutoReply(phone: string): void {
  const entry = _pending.get(phone);
  if (entry) {
    clearTimeout(entry.timer);
    _pending.delete(phone);
  }
}

// Resposta longa vira até 3 bolhas (gente não manda parede de texto)
function splitBubbles(text: string): string[] {
  const raw = text.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  if (raw.length <= 1) return [text.trim()];
  const parts = raw.slice(0, 2);
  const rest  = raw.slice(2).join('\n\n');
  if (rest) parts.push(rest);
  return parts;
}

async function typing(jid: string, forText: string): Promise<void> {
  if (!_socket) return;
  try {
    await _socket.presenceSubscribe(jid);
    await _socket.sendPresenceUpdate('composing', jid);
    const ms = Math.min(8_000, Math.max(1_200, forText.length * 35));
    await new Promise(r => setTimeout(r, ms));
    await _socket.sendPresenceUpdate('paused', jid);
  } catch { /* presença é cosmética — nunca bloqueia o envio */ }
}

async function flushAutoReply(storeId: string, phone: string): Promise<void> {
  const entry = _pending.get(phone);
  _pending.delete(phone);
  if (!entry || !_socket || _status !== 'connected') return;

  const joined = entry.texts.join('\n');
  try {
    const session  = await getOrCreateSession(storeId, phone);
    const response = await processMessage(session, joined);
    const media    = response.media || [];
    // nada a enviar = bot desligado, humano ativo ou silêncio intencional
    if (!response.text && media.length === 0) return;

    const settings = await getRuntimeSettings(storeId);
    if (settings.delay_resposta) await typing(entry.jid, response.text || 'foto');

    // Fotos de produto primeiro (a legenda já traz nome + preço)
    for (const m of media.slice(0, 4)) {
      try {
        await _socket.sendMessage(entry.jid, { image: { url: m.imageUrl }, caption: m.caption });
        await supabase.from('wa_messages').insert({
          store_id: storeId, phone, direction: 'out', text: `📷 ${m.caption}`, timestamp: new Date().toISOString(),
        }).then(null, logWrite('wa_messages'));
        await new Promise(r => setTimeout(r, 900));
      } catch (err) {
        console.warn('[auto-reply] envio de foto falhou:', (err as Error).message);
      }
    }

    // Texto em bolhas humanas
    if (response.text) {
      const bubbles = splitBubbles(response.text);
      for (let i = 0; i < bubbles.length; i++) {
        if (i > 0 && settings.delay_resposta) await typing(entry.jid, bubbles[i]);
        await sendReplyToJid(entry.jid, phone, bubbles[i], storeId);
      }
    }

    console.log('[auto-reply]', phone, '→', `${media.length} foto(s) +`, (response.text || '').slice(0, 60).replace(/\n/g, ' '));
  } catch (err) {
    console.error('[auto-reply] erro:', (err as Error).message);
  }
}

// Envia para o JID exato de origem (funciona para @s.whatsapp.net e @lid)
// e persiste no inbox como as demais mensagens de saída.
async function sendReplyToJid(jid: string, phone: string, text: string, storeId: string): Promise<void> {
  if (!_socket || _status !== 'connected') throw new Error('WhatsApp não conectado.');
  await _socket.sendMessage(jid, { text });

  const ts = new Date().toISOString();
  await supabase.from('wa_messages').insert({
    store_id: storeId, phone, direction: 'out', text, timestamp: ts,
  }).then(null, logWrite('wa_messages'));

  await supabase.from('wa_conversations').upsert({
    store_id:     storeId,
    phone,
    last_message: text,
    last_time:    ts,
    unread_count: 0,
  }, { onConflict: 'store_id,phone' }).then(null, logWrite('wa_conversations'));
}

async function upsertLeadFromInbox(
  storeId: string,
  phone: string,
  name: string,
  firstMessage: string,
  phoneReal?: string | null,
): Promise<string | null> {
  try {
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from('bot_leads')
      .select('id, nome, message_count, phone_real')
      .eq('store_id', storeId)
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      const updates: Record<string, unknown> = {
        atualizado_em:   now,
        last_message_at: now,
        message_count:   (existing.message_count || 0) + 1,
      };
      // MODO TEMPORÁRIO: não sobrescrever/auto-preencher o nome — fica manual.
      // Preenche o telefone real assim que conseguimos resolvê-lo (backfill incremental)
      if (phoneReal && !existing.phone_real) {
        updates.phone_real = phoneReal;
      }
      await supabase.from('bot_leads').update(updates).eq('id', existing.id);
      console.log('[CRM] Lead atualizado:', phone, '| msgs:', updates.message_count);
      return existing.id as string;
    }

    const { data: created, error: insertErr } = await supabase.from('bot_leads').insert({
      store_id:         storeId,
      phone,
      phone_real:       phoneReal || null,
      nome:             name,
      origem:           'whatsapp_inbox',
      status_comercial: 'FRIO',
      interesse:        firstMessage.slice(0, 200),
      kanban_stage:     'novo',
      status:           'qualificado',
      message_count:    1,
      last_message_at:  now,
      qualificado_em:   now,
      atualizado_em:    now,
    }).select('id').single();

    if (insertErr) throw insertErr;
    console.log('[CRM] Lead criado:', phone, '| nome:', name);
    return (created?.id as string) || null;
  } catch (err: unknown) {
    console.error('[CRM] ERRO ao criar/atualizar lead:', {
      storeId, phone,
      error: err instanceof Error ? err.message : JSON.stringify(err),
    });
    return null;
  }
}

export function getWaState() {
  return { status: _status, qr: _qr, storeId: null };
}

async function useSupabaseAuthState(storeId: string) {
  const B = await import('@whiskeysockets/baileys') as any;
  const { initAuthCreds, BufferJSON, proto } = B;

  async function readData(key: string) {
    const { data } = await supabase
      .from('baileys_auth')
      .select('value')
      .eq('store_id', storeId)
      .eq('key', key)
      .maybeSingle();
    if (!data) return null;
    return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
  }

  async function writeData(key: string, value: any) {
    await supabase.from('baileys_auth').upsert({
      store_id: storeId,
      key,
      value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)),
    }, { onConflict: 'store_id,key' });
  }

  async function removeData(key: string) {
    await supabase.from('baileys_auth')
      .delete()
      .eq('store_id', storeId)
      .eq('key', key);
  }

  const creds = (await readData('creds')) || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, any> = {};
        await Promise.all(ids.map(async (id) => {
          let value = await readData(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          result[id] = value;
        }));
        return result;
      },
      set: async (data: Record<string, Record<string, any>>) => {
        await Promise.all(
          Object.entries(data).flatMap(([category, entries]) =>
            Object.entries(entries).map(([id, value]) => {
              const key = `${category}-${id}`;
              return value ? writeData(key, value) : removeData(key);
            })
          )
        );
      },
    },
  };

  return {
    state,
    saveCreds: () => writeData('creds', state.creds),
  };
}

export async function initBaileys(storeId: string): Promise<void> {
  if (!ENABLED) return;
  if (_initializing) return;
  if (_socket && (_status === 'connected' || _status === 'qr_pending')) return;

  _initializing = true;
  try {
    const B = await import('@whiskeysockets/baileys') as any;
    const makeWASocket = B.default ?? B.makeWASocket ?? B;
    const { DisconnectReason } = B;

    const { state, saveCreds } = await useSupabaseAuthState(storeId);

    _socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger as any,
      browser: ['Fluxo Command', 'Chrome', '1.0'],
    });

    _socket.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        _status = 'qr_pending';
        _qr = await qrcode.toDataURL(qr).catch(() => qr);
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        _status = 'disconnected';
        _qr = null;
        _socket = null;
        _initializing = false;
        if (!loggedOut) {
          _disconnectedAt = new Date();
          setTimeout(() => initBaileys(storeId), 5000);
        } else {
          _disconnectedAt = null;
        }
      } else if (connection === 'open') {
        _status = 'connected';
        _qr = null;
        _initializing = false;

        if (AUTO_REPLY) {
          console.log('[auto-reply] BOT_AUTO_REPLY=true — bot responde no WhatsApp real (engine ainda respeita bot_ativo/humano/opt-out)');

          // Handoff: quando a IA aciona chamar_atendente, avisa o operador no zap
          setHandoffNotifier((_sid, phone, motivo) => {
            const op = process.env.OPERATOR_PHONE;
            if (!op || !_socket) return;
            const opJid = normalizePhone(op) + '@s.whatsapp.net';
            _socket.sendMessage(opJid, {
              text: `🔔 Fluxo Command: cliente ${formatPhone(phone)} pediu atendimento humano.\nMotivo: ${motivo}`,
            }).catch(() => {});
          });

          // Follow-up de leads abandonados (só liga com FOLLOWUP_ATIVO=true)
          startFollowUpLoop(storeId, async (phone: string, text: string) => {
            const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
            await sendReplyToJid(jid, phone, text, storeId);
          });
        }

        const operatorPhone = process.env.OPERATOR_PHONE;
        if (operatorPhone && _disconnectedAt) {
          const fell = _disconnectedAt;
          _disconnectedAt = null;
          const sock = _socket;
          setTimeout(async () => {
            try {
              const opJid = normalizePhone(operatorPhone) + '@s.whatsapp.net';
              const ts = fell.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
              await sock.sendMessage(opJid, { text: `⚠️ Fluxo Command: WhatsApp ficou offline em ${ts}.` });
              await sock.sendMessage(opJid, { text: `✅ Fluxo Command: WhatsApp reconectado com sucesso.` });
            } catch (e) {
              console.error('[alert] Erro ao enviar alerta ao operador:', e);
            }
          }, 3000);
        } else {
          _disconnectedAt = null;
        }
      }
    });

    _socket.ev.on('creds.update', saveCreds);

    // MODO OBSERVADOR — nunca responder automaticamente
    _socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const jid = msg.key.remoteJid || '';
        // Ignorar grupos e broadcasts — só processar contatos privados
        if (jid.endsWith('@g.us')) continue;
        if (jid === 'status@broadcast') continue;

        const phone = normalizePhone(jid);

        let text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption || '';

        // Áudio (voice note): transcreve via Gemini e segue o fluxo como texto.
        // engineText vai pro motor sem o prefixo; o inbox guarda com 🎤.
        let engineText = text;
        if (!text && !msg.key.fromMe && AUTO_REPLY && msg.message?.audioMessage) {
          try {
            const B = await import('@whiskeysockets/baileys') as any;
            const buf = await B.downloadMediaMessage(
              msg, 'buffer', {},
              { logger: silentLogger, reuploadRequest: _socket?.updateMediaMessage },
            ) as Buffer;
            const transcript = await transcribeAudio(buf, msg.message.audioMessage.mimetype || 'audio/ogg');
            if (transcript) {
              engineText = transcript;
              text       = `🎤 ${transcript}`;
              console.log('[audio] transcrito:', transcript.slice(0, 80));
            }
          } catch (err) {
            console.warn('[audio] transcrição falhou:', (err as Error).message);
          }
        }

        // Visão: cliente mandou FOTO (ex: print de peça que quer) — descreve
        // via Gemini e o agente busca parecido no catálogo.
        if (!msg.key.fromMe && AUTO_REPLY && msg.message?.imageMessage) {
          try {
            const B = await import('@whiskeysockets/baileys') as any;
            const buf = await B.downloadMediaMessage(
              msg, 'buffer', {},
              { logger: silentLogger, reuploadRequest: _socket?.updateMediaMessage },
            ) as Buffer;
            const desc = await describeImage(buf, msg.message.imageMessage.mimetype || 'image/jpeg');
            if (desc) {
              const caption = text; // caption da foto, se houver
              engineText = caption
                ? `${caption}\n(enviei uma foto de: ${desc})`
                : `Enviei uma foto de: ${desc} — vocês têm algo assim?`;
              text = caption ? `${caption} 📷 [foto: ${desc}]` : `📷 [foto: ${desc}]`;
              console.log('[visao] foto descrita:', desc.slice(0, 80));
            }
          } catch (err) {
            console.warn('[visao] análise de foto falhou:', (err as Error).message);
          }
        }

        if (!text || !phone) continue;

        const ts = new Date(Number(msg.messageTimestamp) * 1000).toISOString();

        if (msg.key.fromMe) {
          // Operador assumiu a conversa pelo celular — bot não atropela
          cancelAutoReply(phone);
          // Mensagem enviada pelo celular — salva como saída, sem criar lead, sem unread
          await supabase.from('wa_messages').insert({
            store_id: storeId, phone, direction: 'out', text, timestamp: ts,
          }).then(null, logWrite('wa_messages'));

          await supabase.from('wa_conversations').upsert({
            store_id:     storeId,
            phone,
            last_message: text,
            last_time:    ts,
            is_group:     false,
          }, { onConflict: 'store_id,phone' }).then(null, logWrite('wa_conversations'));
          continue;
        }

        // Mensagem recebida — comportamento completo
        const phoneReal = await resolvePhoneReal(msg);
        // MODO TEMPORÁRIO: não puxar o pushName do WhatsApp. O lead chega só com o
        // número (real, quando resolvido); o nome é preenchido manualmente no inbox.
        const name = formatPhone(phoneReal || phone);
        const leadId = await upsertLeadFromInbox(storeId, phone, name, text, phoneReal);

        await supabase.from('wa_messages').insert({
          store_id: storeId, phone, direction: 'in', text, timestamp: ts, lead_id: leadId,
        }).then(null, logWrite('wa_messages'));

        const { data: existingConv } = await supabase
          .from('wa_conversations')
          .select('unread_count')
          .eq('store_id', storeId)
          .eq('phone', phone)
          .single();

        await supabase.from('wa_conversations').upsert({
          store_id:     storeId,
          phone,
          name,
          last_message: text,
          last_time:    ts,
          is_group:     false,
          lead_id:      leadId,
          unread_count: (existingConv?.unread_count || 0) + 1,
        }, { onConflict: 'store_id,phone' }).then(null, logWrite('wa_conversations'));

        // Auto-resposta (opt-in) — entra no buffer de debounce e o engine decide
        if (AUTO_REPLY) queueAutoReply(storeId, phone, jid, engineText);
      }
    });

  } catch (err) {
    console.error('[Baileys] init error:', err);
    _status = 'unavailable';
    _initializing = false;
  }
}

// Resolve o JID de SAÍDA correto. O WhatsApp esconde muitos contatos atrás de
// LID (bot_leads.phone guarda o LID; o número real fica em phone_real). Mandar
// LID para @s.whatsapp.net falha silenciosamente — precisa ir para @lid.
async function resolveOutgoingJid(digits: string, storeId: string): Promise<string> {
  if (digits.includes('@')) return digits;
  try {
    const { data } = await supabase
      .from('bot_leads')
      .select('phone_real')
      .eq('store_id', storeId)
      .eq('phone', digits)
      .maybeSingle();
    const real = String(data?.phone_real || '').replace(/\D/g, '');
    if (real && real !== digits) return `${digits}@lid`;
  } catch { /* segue pra heurística */ }
  // LIDs são IDs longos; número BR canônico tem 12–13 dígitos
  if (digits.length >= 14) return `${digits}@lid`;
  return `${digits}@s.whatsapp.net`;
}

export async function sendWaMessage(phone: string, text: string, storeId: string): Promise<void> {
  if (!ENABLED || !_socket || _status !== 'connected') {
    throw new Error('WhatsApp não conectado.');
  }
  const normalizedPhone = normalizePhone(phone);
  const jid = await resolveOutgoingJid(normalizedPhone, storeId);
  await _socket.sendMessage(jid, { text });

  const ts = new Date().toISOString();
  await supabase.from('wa_messages').insert({
    store_id: storeId, phone: normalizedPhone, direction: 'out', text, timestamp: ts,
  }).then(null, logWrite('wa_messages'));

  await supabase.from('wa_conversations').upsert({
    store_id:     storeId,
    phone:        normalizedPhone,
    last_message: text,
    last_time:    ts,
    unread_count: 0,
  }, { onConflict: 'store_id,phone' }).then(null, logWrite('wa_conversations'));
}

export async function disconnectBaileys(): Promise<void> {
  if (_socket) {
    await _socket.logout().catch(() => _socket?.end?.());
    _socket = null;
  }
  _status = ENABLED ? 'disconnected' : 'unavailable';
  _qr = null;
  _initializing = false;
}
