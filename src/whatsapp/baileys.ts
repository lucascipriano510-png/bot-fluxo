// ═══════════════════════════════════════════════════════════════════════════
//  baileys.ts — STUB para Vercel serverless.
//
//  @whiskeysockets/baileys é ESM-only e requer processo Node.js persistente.
//  Não funciona em Vercel serverless (CommonJS, sem WebSocket persistente).
//  Para usar Baileys, rode o servidor em Railway / Render / VPS.
//
//  Este stub mantém a interface pública intacta para o bundle não quebrar.
// ═══════════════════════════════════════════════════════════════════════════

export type WaStatus = 'connected' | 'qr_pending' | 'disconnected' | 'unavailable';

export function getWaState() {
  return { status: 'unavailable' as WaStatus, qr: null, storeId: null };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function initBaileys(_storeId: string): Promise<void> {
  // no-op em Vercel — requer servidor dedicado
}

export async function sendWaMessage(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _phone: string, _text: string, _storeId: string,
): Promise<void> {
  throw new Error('WhatsApp requer servidor dedicado (não disponível na Vercel).');
}

export async function disconnectBaileys(): Promise<void> {
  // no-op
}
