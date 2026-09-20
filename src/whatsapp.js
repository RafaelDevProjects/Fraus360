import axios from 'axios';

const GRAPH_VERSION = 'v20.0';

function client() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  return axios.create({
    baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// Envia uma mensagem de texto simples.
// O WhatsApp nao renderiza HTML/markdown - usamos *negrito* e quebras de linha,
// que sao os unicos recursos de formatacao suportados nativamente.
export async function sendText(to, body) {
  try {
    await client().post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem WhatsApp:', err.response?.data || err.message);
  }
}

// Extrai o texto e o remetente de um payload de webhook recebido do WhatsApp.
// Retorna null se o payload nao contiver uma mensagem de texto (ex: status de entrega).
export function parseIncomingMessage(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') return null;

  return {
    from: message.from, // numero do usuario, ja no formato internacional
    text: message.text.body,
    messageId: message.id,
  };
}
