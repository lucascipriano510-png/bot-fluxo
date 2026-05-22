// Simulador de conversa no terminal — sem precisar de WhatsApp real
// Uso: npm run simulate

import 'dotenv/config';
import * as readline from 'readline';
import { processMessage } from './bot/engine';
import { getOrCreateSession, resetSession } from './services/sessionService';

const TEST_PHONE = '5534900000000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

async function main() {
  console.log('\n🤖 bot-fluxo — Simulador de conversa');
  console.log('   Digite "reset" para reiniciar a sessão');
  console.log('   Digite "sair" para encerrar\n');

  await resetSession(TEST_PHONE);
  const session = await getOrCreateSession(TEST_PHONE);
  const { processMessage: pm } = await import('./bot/engine');

  // Exibe mensagem inicial
  const intro = await pm(session, 'oi');
  console.log(`\n🤖 Bot: ${intro.text}\n`);

  while (true) {
    const input = await ask('👤 Você: ');

    if (input.toLowerCase() === 'sair') break;

    if (input.toLowerCase() === 'reset') {
      await resetSession(TEST_PHONE);
      const fresh = await getOrCreateSession(TEST_PHONE);
      const res = await pm(fresh, 'oi');
      console.log(`\n🤖 Bot: ${res.text}\n`);
      continue;
    }

    const currentSession = await getOrCreateSession(TEST_PHONE);
    const response = await processMessage(currentSession, input);
    console.log(`\n🤖 Bot: ${response.text}`);
    console.log(`   [nó atual: ${response.nextNode}]\n`);
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
