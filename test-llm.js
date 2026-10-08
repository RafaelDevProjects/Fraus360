// Testa a LLM sem precisar do WhatsApp:
//   node test-llm.js "oi, recebi esse link banc0-itau-premios.com, é golpe?"
import 'dotenv/config';
import { classifyMessage, generateReply } from './src/llm.js';

const text = process.argv.slice(2).join(' ') || 'oi, o que voce faz?';
try {
  console.log('Mensagem:', text);
  console.log('Classificacao:', await classifyMessage(text));
  console.log('Resposta:\n' + (await generateReply(text)));
} catch (e) {
  console.error('ERRO:', e.message);
}