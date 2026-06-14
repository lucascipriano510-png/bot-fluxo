// Runner manual do sync de compras do site → CRM (usa o serviço REAL).
// Uso: npx tsx scripts/run-sync-site-purchases.ts
import { syncSitePurchases } from '../src/services/sitePurchaseService';

syncSitePurchases()
  .then((r) => { console.log('RESULTADO:', JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error('ERRO:', e); process.exit(1); });
