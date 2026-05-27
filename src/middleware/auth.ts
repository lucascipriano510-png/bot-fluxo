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
  let storeId: string | undefined = user.app_metadata?.store_id;

  // Fallback: conta antiga sem app_metadata — busca em store_users
  if (!storeId) {
    const { data: su } = await supabase
      .from('store_users')
      .select('store_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!su?.store_id) {
      return res.status(403).json({ ok: false, error: 'Sem acesso a nenhuma loja' });
    }

    storeId = su.store_id;
    // Corrige app_metadata em background para evitar fallback nas próximas requisições
    supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, store_id: storeId, role: 'owner' },
    }).catch(() => {});
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

    if (store.status !== 'active' && store.status !== 'trial') {
      console.log(`[webhook] store "${slug}" blocked — status: ${store.status}`);
      return res.status(200).json({ ok: false, error: 'Store inactive' });
    }

    req.storeId = store.storeId;
    (req as Request & { storeCtx: unknown }).storeCtx = store;
    next();
  } catch {
    return res.status(404).json({ ok: false, error: `Loja "${slug}" não encontrada` });
  }
}
