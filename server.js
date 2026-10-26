import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { handleIncomingMessage } from './src/messageHandler.js';
import { resumo } from './src/metrics.js';

// Confere o .env na inicialização e avisa o que estiver faltando ou quebrado.
function validarAmbiente() {
  const obrigatorias = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'OPENROUTER_API_KEY'];
  const faltando = obrigatorias.filter((v) => !process.env[v]);
  if (faltando.length) console.warn(`⚠️  Faltando no .env: ${faltando.join(', ')}`);
  for (const [nome, valor] of Object.entries(process.env)) {
    if (/^(OPENROUTER|WHATSAPP|GOOGLE|VIRUSTOTAL)/.test(nome) && /[A-Z_]{4,}=/.test(valor || '')) {
      console.warn(`⚠️  ${nome} parece ter outra variável grudada (falta uma quebra de linha no .env)`);
    }
  }
  if (!process.env.META_APP_SECRET) console.warn('ℹ️  META_APP_SECRET vazio: assinatura do webhook não está sendo verificada');
  const opcionais = ['GOOGLE_SAFE_BROWSING_KEY', 'VIRUSTOTAL_API_KEY'].filter((v) => !process.env[v]);
  if (opcionais.length) console.warn(`ℹ️  Fontes de link desligadas (opcional): ${opcionais.join(', ')}`);
}

const app = express();
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Garante que a chamada veio mesmo da Meta (cabeçalho X-Hub-Signature-256).
function assinaturaValida(req) {
  const segredo = process.env.META_APP_SECRET;
  if (!segredo) return true;
  const recebida = req.get('x-hub-signature-256') || '';
  const esperada = `sha256=${crypto.createHmac('sha256', segredo).update(req.rawBody || '').digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
  } catch {
    return false;
  }
}

// A Meta chama esse GET ao configurar o webhook, para confirmar que o servidor é seu.
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  console.warn('[webhook] validação recusada: confira o WHATSAPP_VERIFY_TOKEN no .env e no painel da Meta');
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  if (!assinaturaValida(req)) {
    console.warn('[webhook] assinatura inválida, ignorando. Confira o META_APP_SECRET no .env (ou deixe vazio para testar)');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // responde já: se demorar, a Meta reenvia
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      // Status das mensagens que o bot enviou: mostra quando a Meta recusou a entrega.
      for (const st of change.value?.statuses || []) {
        if (st.status === 'failed') {
          const e = st.errors?.[0] || {};
          console.error(`[webhook] Meta NÃO entregou a resposta: código ${e.code} - ${e.title || e.message}${e.error_data?.details ? ` (${e.error_data.details})` : ''}`);
          if (e.code === 131030) console.error('           → O número não está na lista de destinatários do número de teste (painel da Meta > WhatsApp > Configuração da API).');
          if (e.code === 131047) console.error('           → Passaram mais de 24 h desde a última mensagem do usuário: peça para ele mandar uma mensagem nova.');
        } else if (process.env.LOG_STATUS === '1') {
          console.log(`[webhook] status: ${st.status}`);
        }
      }
      for (const msg of change.value?.messages || []) {
        console.log(`[webhook] mensagem recebida (${msg.type}) de …${String(msg.from).slice(-4)}`);
        handleIncomingMessage(msg).catch((err) => console.error('Erro ao processar mensagem:', err));
      }
    }
  }
});

// Números de uso para o pitch: /stats?token=SEU_STATS_TOKEN
app.get('/stats', (req, res) => {
  if (!process.env.STATS_TOKEN || req.query.token !== process.env.STATS_TOKEN) return res.sendStatus(404);
  res.json(resumo());
});

app.get('/', (_req, res) => res.send('Fraus MVP no ar 🛡️'));

validarAmbiente();
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Fraus rodando na porta ${port}`));