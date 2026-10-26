// src/whatsappSend.js
// Envio pela WhatsApp Cloud API: texto, botões e download de mídia (prints).
// Com DRY_RUN=1 (usado pelo simulador), nada vai para a Meta: tudo é impresso no terminal.
import fs from 'node:fs';

const cfg = () => ({
  versao: process.env.GRAPH_API_VERSION || 'v21.0',
  token: process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID,
  dry: process.env.DRY_RUN === '1',
});

// O WhatsApp conta caracteres (emoji inclusive); corta sem quebrar emoji.
function corta(texto, max) {
  const a = Array.from(String(texto));
  return a.length > max ? `${a.slice(0, max - 1).join('')}…` : a.join('');
}

function imprimir(texto) {
  console.log(`\n\x1b[36m┌─ Fraus\x1b[0m\n${String(texto).split('\n').map((l) => `│ ${l}`).join('\n')}\n└─`);
}

// Celulares brasileiros: o webhook às vezes entrega o número SEM o nono dígito
// (55 11 8765-4321 em vez de 55 11 98765-4321). Respondendo a esse número, a Meta
// recusa com o erro 131030 no número de teste. Aqui o 9 é recolocado.
export function normalizarNumeroBR(numero) {
  const d = String(numero).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

async function enviar(payload) {
  const c = cfg();
  payload = { ...payload, to: normalizarNumeroBR(payload.to) };
  const res = await fetch(`https://graph.facebook.com/${c.versao}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.code;
    if (code === 190) console.error('[WhatsApp] Token expirado ou inválido: gere um novo e atualize WHATSAPP_TOKEN no .env');
    if (code === 131030) console.error(`[WhatsApp] O número ${payload.to} não está na lista de destinatários do número de teste (painel da Meta > WhatsApp > Configuração da API)`);
    if (code === 100 || code === 133010) console.error('[WhatsApp] Confira o WHATSAPP_PHONE_NUMBER_ID no .env: ele é o ID do número, não o número de telefone');
    throw new Error(`[WhatsApp] HTTP ${res.status}: ${JSON.stringify(err).slice(0, 300)}`);
  }
  return res.json();
}

export async function sendText(to, body) {
  if (cfg().dry) return imprimir(body);
  return enviar({ to, type: 'text', text: { body: corta(body, 4096), preview_url: false } });
}

// Até 3 botões, título de até 20 caracteres. Corpo maior que 1024 vai antes como texto.
export async function sendButtons(to, body, botoes) {
  const buttons = botoes.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: corta(b.title, 20) } }));
  let corpo = body;
  if (Array.from(body).length > 1024) {
    await sendText(to, body);
    corpo = 'O que você quer fazer agora?';
  }
  if (cfg().dry) {
    if (corpo === body) imprimir(body);
    console.log(`  ${buttons.map((b) => `\x1b[33m[/b ${b.reply.id}]\x1b[0m ${b.reply.title}`).join('   ')}`);
    return;
  }
  return enviar({ to, type: 'interactive', interactive: { type: 'button', body: { text: corpo }, action: { buttons } } });
}

// Baixa a imagem que o usuário mandou. No simulador, "file:caminho" lê um arquivo local.
export async function downloadMedia(mediaId) {
  if (mediaId.startsWith('file:')) {
    const caminho = mediaId.slice(5);
    const ext = caminho.split('.').pop().toLowerCase();
    return { buffer: await fs.promises.readFile(caminho), mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  }
  const c = cfg();
  const auth = { Authorization: `Bearer ${c.token}` };
  const meta = await fetch(`https://graph.facebook.com/${c.versao}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(10000) })
    .then((r) => r.json());
  if (!meta.url) throw new Error(`Mídia sem URL: ${JSON.stringify(meta).slice(0, 200)}`);
  const res = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Download da mídia falhou: HTTP ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type || res.headers.get('content-type') || 'image/jpeg' };
}