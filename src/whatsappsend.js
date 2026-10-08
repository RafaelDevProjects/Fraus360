// src/whatsappSend.js (envio de mensagens; seu src/whatsapp.js continua intacto)
// Envio de mensagens pela WhatsApp Cloud API. O token vem do .env,
// então trocar o token = editar WHATSAPP_TOKEN e reiniciar o servidor.

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

export async function sendText(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID)}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: String(body).slice(0, 4096) }, // limite do WhatsApp
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err?.error?.code === 190) {
      console.error('[WhatsApp] Token expirado ou inválido. Gere um novo e atualize WHATSAPP_TOKEN no .env');
    }
    throw new Error(`[WhatsApp] HTTP ${res.status}: ${JSON.stringify(err).slice(0, 300)}`);
  }
  return res.json();
}