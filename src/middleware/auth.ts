import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { getStoreById, getStoreBySlug } from '../services/storeService';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Não autenticado' });
  }

  const token = auth.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ ok: false, error: 'Sessão inválida' });
  }

  // Lê store_id do app_metadata (no JWT) — sem query extra ao banco
  const storeId: string | undefined = user.app_metadata?.store_id;

  if (!storeId) {
    return res.status(403).json({ ok: false, error: 'Sem acesso a nenhuma loja' });
  }

  req.storeId = storeId;
  next();
}

// Middleware que identifica a loja pelo slug na URL (/webhook/:storeSlug)
// Não exige autenticação — webhook é chamado pelo provider de WhatsApp
export async function resolveStoreBySlug(req: Request, res: Response, next: NextFunction) {
  const slug = req.params.storeSlug;
  if (!slug) return res.status(400).json({ ok: false, error: 'storeSlug obrigatório' });

  try {
    const store = await getStoreBySlug(slug);
    req.storeId = store.storeId;
    (req as Request & { storeCtx: unknown }).storeCtx = store;
    next();
  } catch {
    return res.status(404).json({ ok: false, error: `Loja "${slug}" não encontrada` });
  }
}
