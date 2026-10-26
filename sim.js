// Simulador: converse com o Fraus no terminal, sem WhatsApp, sem túnel, sem token da Meta.
//   npm run simular
// Usa a mesma lógica do bot real. Os dados ficam em data-sim/ (separados dos reais).
import 'dotenv/config';
import readline from 'node:readline';

process.env.DRY_RUN = '1';
process.env.DATA_DIR ||= 'data-sim';

const { handleIncomingMessage } = await import('./src/messageHandler.js');
const { gravarAgora } = await import('./src/store.js');

const from = process.env.SIM_NUMERO || '5511999990000';
let n = 0;
const base = () => ({ id: `sim-${Date.now()}-${n++}`, from });

console.log(`
\x1b[1mSimulador do Fraus\x1b[0m — escreva como se fosse no WhatsApp.
  texto normal         → mensagem
  /fwd <texto>         → mensagem encaminhada
  /b <id>              → tocar num botão (ex.: /b denunciar)
  /img <caminho>       → mandar um print (ex.: /img C:\\prints\\golpe.jpg)
  /sair                → encerrar
Dica: cole cada mensagem numa linha só.`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\n\x1b[32mvocê>\x1b[0m ' });
rl.prompt();

// Fila: cada mensagem só é processada depois que a anterior terminou (como no WhatsApp).
let fila = Promise.resolve();
rl.on('line', (linha) => {
  fila = fila.then(() => processar(linha.trim())).catch((err) => console.error(err));
});

async function processar(linha) {
  if (!linha) return rl.prompt();
  if (linha === '/sair') {
    gravarAgora();
    process.exit(0);
  }
  let msg;
  if (linha.startsWith('/b ')) msg = { ...base(), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: linha.slice(3).trim() } } };
  else if (linha.startsWith('/img ')) msg = { ...base(), type: 'image', image: { id: `file:${linha.slice(5).trim().replace(/^"|"$/g, '')}`, caption: '' } };
  else if (linha.startsWith('/fwd ')) msg = { ...base(), type: 'text', text: { body: linha.slice(5) }, context: { forwarded: true } };
  else msg = { ...base(), type: 'text', text: { body: linha } };
  console.log(`\x1b[2m(você enviou: ${linha.slice(0, 80)}${linha.length > 80 ? '…' : ''})\x1b[0m`);
  await handleIncomingMessage(msg);
  rl.prompt();
}
