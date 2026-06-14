// ═══════════════════════════════════════════════════════════════════════════
//  API router — assembler.
//  As rotas vivem em arquivos por feature (src/routes/<feature>.ts). Para mexer
//  no Kanban/leads → leads.ts; produtos → products.ts; e assim por diante.
//  Aqui só montamos a ordem e o limite de autenticação.
// ═══════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

import publicRouter       from './public';
import sessionsRouter     from './sessions';
import leadsRouter        from './leads';
import productsRouter     from './products';
import reportsRouter      from './reports';
import flowRouter         from './flow';
import settingsRouter     from './settings';
import respostasRouter    from './respostas';
import integrationsRouter from './integrations';
import brainRouter        from './brain';
import whatsappRouter     from './whatsapp';

const router = Router();

// ── Rotas públicas (sem auth): /health, /config, /signup ─────────────────────
router.use(publicRouter);

// ── A partir daqui, tudo exige autenticação ──────────────────────────────────
router.use(requireAuth);

router.use(sessionsRouter);
router.use(leadsRouter);
router.use(productsRouter);
router.use(reportsRouter);
router.use(flowRouter);
router.use(settingsRouter);
router.use(respostasRouter);
router.use(integrationsRouter);
router.use(brainRouter);
router.use(whatsappRouter);

export default router;
