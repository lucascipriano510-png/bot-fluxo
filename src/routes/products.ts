import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase';
import { normalizePhone } from '../utils/phone';
import { fetchLeads } from '../services/leadService';
import { fetchHistorico } from '../services/mensagemService';
import { FLOW_MAP } from '../bot/flowMap';
import { loadFlowConfig, invalidateFlowCache } from '../services/flowConfigService';
import { getPreset, BusinessType } from '../bot/flowPresets';
import { getStoreContext, getStoreById } from '../services/storeService';
import { fetchProductsForPanel } from '../inventory/inventoryBridge';
import { loadSettings, saveSettings, getRuntimeSettings } from '../services/settingsService';
import { getOrCreateSession, resetSession } from '../services/sessionService';
import { processMessage } from '../bot/engine';
import { saveMensagem } from '../services/mensagemService';
import { checkRateLimit } from '../utils/rateLimiter';
import { requireAuth } from '../middleware/auth';
import { sendMessage, invalidateCredCache } from '../providers/messaging';
import { runStoreAnalysis } from '../services/analysisService';
import { recordConversion } from '../services/storeBrainService';
import { initBaileys, getWaState, sendWaMessage, disconnectBaileys } from '../whatsapp/baileys';
import { updateLeadScore, calculateLeadScore } from '../services/leadScoreService';
import { analyzeSingleLead, processAllLeads, processNewLeads } from '../services/leadIntelligence';
import { syncSitePurchases } from '../services/sitePurchaseService';
import { errMsg, cronAuthorized } from './_shared';

const router = Router();

router.get('/products', async (req, res) => {
  try {
    const { category, q } = req.query as { category?: string; q?: string };
    const data = await fetchProductsForPanel(req.storeId!, {
      category: category && category !== 'all' ? category : undefined,
      q:        q && q.trim() ? q.trim() : undefined,
    });
    res.json({ ok: true, data, count: data.length });
  } catch (err: unknown) {
    res.json({ ok: false, data: [], error: errMsg(err) });
  }
});

router.post('/products', async (req, res) => {
  try {
    const {
      name, sku, price, promotional_price, category, subcategory, product_type, color, sizes, image_url, is_active, featured, stock,
      item_type, description, price_type, bot_instructions, tags, qualification_questions,
      duration_minutes, requires_scheduling, service_location, included_items,
    } = req.body as Record<string, unknown>;
    if (!String(name || '').trim()) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
    const resolvedItemType = item_type ? String(item_type) : 'produto_fisico';
    const isKit      = resolvedItemType === 'pacote_combo';
    const isPhysical = resolvedItemType === 'produto_fisico';

    // Normaliza sizes: aceita array (kit/produto) ou null
    let sizesValue: unknown = sizes || null;
    if (isKit && !sizesValue) sizesValue = [];

    const { data: rows, error } = await supabase
      .from('products')
      .insert({
        store_id:                req.storeId!,
        name:                    String(name).trim(),
        sku:                     sku ? String(sku).trim() : null,
        price:                   price != null ? Number(price) : null,
        promotional_price:       promotional_price ? Number(promotional_price) : null,
        category:                category ? String(category).trim() : null,
        subcategory:             subcategory ? String(subcategory).trim() : null,
        product_type:            product_type ? String(product_type).trim() : null,
        color:                   color ? String(color).trim() : null,
        sizes:                   sizesValue,
        image_url:               image_url ? String(image_url).trim() : null,
        is_active:               is_active !== false,
        featured:                featured === true,
        stock:                   isPhysical ? (Number(stock) || 0) : null,
        item_type:               resolvedItemType,
        description:             description ? String(description).trim() : null,
        price_type:              price_type ? String(price_type) : 'fixo',
        bot_instructions:        bot_instructions ? String(bot_instructions).trim() : null,
        tags:                    Array.isArray(tags) ? tags : null,
        qualification_questions: qualification_questions ?? null,
        duration_minutes:        duration_minutes ? Number(duration_minutes) : null,
        requires_scheduling:     requires_scheduling === true,
        service_location:        service_location ? String(service_location).trim() : null,
        included_items:          included_items ? String(included_items).trim() : null,
      })
      // Não usar .single() — kit pode ter triggers/views que retornam múltiplas linhas
      .select('id,store_id,name,sku,price,promotional_price,category,subcategory,product_type,color,sizes,image_url,is_active,featured,stock,item_type,description,price_type,bot_instructions,tags,qualification_questions,duration_minutes,requires_scheduling,service_location,included_items,created_at,updated_at');
    if (error) throw error;
    const product = Array.isArray(rows) ? rows[0] : null;
    if (!product) return res.status(500).json({ ok: false, error: 'Produto não retornado após criar.' });
    res.json({ ok: true, data: product });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const allowed = [
      'name','sku','price','promotional_price','category','subcategory','product_type','color','sizes','image_url','is_active','featured','stock',
      'item_type','description','price_type','bot_instructions','tags','qualification_questions',
      'duration_minutes','requires_scheduling','service_location','included_items',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ ok: false, error: 'Nenhum campo enviado' });

    // Não usar .single() — kit pode retornar múltiplas linhas em alguns schemas de produção
    const { data: rows, error } = await supabase
      .from('products')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!)
      .select('id,store_id,name,sku,price,promotional_price,category,subcategory,product_type,color,sizes,image_url,is_active,featured,stock,item_type,description,price_type,bot_instructions,tags,qualification_questions,duration_minutes,requires_scheduling,service_location,included_items,created_at,updated_at');
    if (error) throw error;
    const product = Array.isArray(rows) ? rows[0] : null;
    if (!product) return res.status(404).json({ ok: false, error: 'Produto não encontrado' });
    res.json({ ok: true, data: product });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('store_id', req.storeId!);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: unknown) {
    res.json({ ok: false, error: errMsg(err) });
  }
});

// ── Leads CRM ─────────────────────────────────────────────────────────────────

export default router;
