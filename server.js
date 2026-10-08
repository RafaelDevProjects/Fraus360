import 'dotenv/config';
import express from 'express';
import { handleIncomingMessage } from './src/messageHandler.js';

const app = express();
app.use(express.json());

// A Meta chama esse GET uma vez, ao configurar o webhook no painel de desenvolvedores,
// só pra confirmar que o servidor é seu.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Toda mensagem recebida no WhatsApp chega aqui.
app.post('/webhook', (req, res) => {
  // Responde 200 imediatamente - a Meta reenvia o webhook se não receber
  // confirmação rápida, o que causaria mensagens duplicadas.
  res.sendStatus(200);

  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      const messages = change.value?.messages;
      if (!messages) continue; // ex: notificação de status de entrega (enviada/lida)

      for (const msg of messages) {
        handleIncomingMessage(msg).catch((err) =>
          console.error('Erro ao processar mensagem:', err)
        );
      }
    }
  }
});

app.get('/', (_req, res) => res.send('Guardião MVP no ar.'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Guardião rodando na porta ${port}`));