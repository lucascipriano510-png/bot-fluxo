import app from './app';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`\n🤖 bot-fluxo rodando em http://localhost:${PORT}`);
  console.log(`   Painel visual: http://localhost:${PORT}`);
  console.log(`   POST /webhook  → provider WhatsApp`);
  console.log(`   POST /send     → teste manual`);
  console.log(`   POST /reset    → resetar sessão\n`);
});
