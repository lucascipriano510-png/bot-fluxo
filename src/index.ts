import app from './app';
import { initBaileys } from './whatsapp/baileys';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`\n🤖 bot-fluxo rodando em http://localhost:${PORT}`);
  console.log(`   Painel visual: http://localhost:${PORT}`);
  console.log(`   POST /webhook  → provider WhatsApp`);
  console.log(`   POST /send     → teste manual`);
  console.log(`   POST /reset    → resetar sessão\n`);

  if (process.env.ENABLE_BAILEYS === 'true') {
    const BOOT_STORE_ID = process.env.STORE_ID || '';
    if (BOOT_STORE_ID) {
      setTimeout(() => {
        initBaileys(BOOT_STORE_ID).catch(err =>
          console.error('[boot] initBaileys falhou:', err)
        );
      }, 3000);
    } else {
      console.warn('[boot] STORE_ID não definido — Baileys não inicializado no boot.');
    }
  }

  // Self-ping a cada 4 min para evitar sleep do Render free tier
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    const doPing = () => {
      fetch(`${RENDER_URL}/status`)
        .then(r => console.log('[keep-alive] ping ok', r.status))
        .catch(() => {});
    };
    doPing(); // ping imediato no boot
    setInterval(doPing, 4 * 60 * 1000);
  }
});
