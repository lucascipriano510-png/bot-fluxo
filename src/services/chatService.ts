import { getStoreContext } from './storeService';
import { getOrCreateSession } from './sessionService';
import { processMessage } from '../bot/engine';
import { checkRateLimit } from '../utils/rateLimiter';

export interface ChatResult {
  reply: string;
  nextNode: string;
  detectedIntent?: string;
  confidence?: number;
}

export async function processChat(phone: string, message: string): Promise<ChatResult> {
  if (!checkRateLimit(phone)) {
    const err = new Error('Muitas mensagens. Aguarde um momento.') as Error & { code: string };
    err.code = 'RATE_LIMITED';
    throw err;
  }
  const storeCtx = await getStoreContext();
  const session  = await getOrCreateSession(storeCtx.storeId, phone);
  const response = await processMessage(session, message);
  return {
    reply:          response.text,
    nextNode:       response.nextNode,
    detectedIntent: response.detectedIntent,
    confidence:     response.confidence,
  };
}
