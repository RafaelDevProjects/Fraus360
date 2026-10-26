// src/llm.js
// Integração com o OpenRouter (modelos gratuitos), com troca automática de modelo se um falhar.
// Papel da IA no Fraus: classificar intenção, LER prints e EXPLICAR resultados.
// Quem decide o nível de risco são as regras e as fontes verificáveis, não a IA.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const lista = (valor, padrao) => (valor || padrao).split(',').map((m) => m.trim()).filter(Boolean);
const modelosTexto = () => lista(process.env.OPENROUTER_MODELS, 'google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free');
// "openrouter/free" escolhe sozinho um modelo gratuito que aceite imagem quando a mensagem tem imagem.
const modelosVisao = () => lista(process.env.OPENROUTER_VISION_MODELS, 'google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free');

const SYSTEM_PROMPT = `Você é o Fraus, um assistente antifraude brasileiro que conversa pelo WhatsApp.
Regras:
- Responda em português do Brasil, curto e claro (no máximo 5 linhas), com tom calmo e acolhedor.
- Escreva como uma pessoa conversando no WhatsApp: sem títulos e sem rótulos como "O que foi verificado:".
- Nunca peça senha, código, token ou dados de cartão.
- Nunca afirme que algo é seguro; diga apenas o que foi verificado.
- Nunca invente números de telefone, sites ou canais oficiais. Se precisar, diga "o canal oficial que está no app ou no verso do cartão".
- O WhatsApp só aceita *negrito* e _itálico_: não use #, tabelas ou listas numeradas longas.`;

// Mascara CPF e cartão antes de mandar texto a um modelo gratuito (que pode registrar prompts).
export function maskSensitive(text = '') {
  return String(text)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[NUMERO]');
}

// Modelo que falhou fica "de castigo" por um tempo e é pulado, para não perder
// tempo tentando de novo a cada mensagem. 429 (limite): 5 min. 404 (saiu do ar): 6 h.
const pausados = new Map(); // modelo -> timestamp até quando pular
const PAUSA = { 429: 5 * 60000, 404: 6 * 3600000, 402: 30 * 60000, 503: 2 * 60000, 502: 2 * 60000 };

function pausar(model, status) {
  const ms = PAUSA[status] ?? 60000;
  pausados.set(model, Date.now() + ms);
  console.warn(`[LLM] pulando ${model} pelos próximos ${Math.round(ms / 60000)} min`);
}

export async function callLLM(messages, { maxTokens = 400, temperature = 0.3, modelos = modelosTexto() } = {}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY não definida no .env');

  let ultimoErro;
  const ativos = modelos.filter((m) => !(pausados.get(m) > Date.now()));
  // Se todos estiverem pausados, tenta todos mesmo assim (melhor que não responder).
  for (const model of ativos.length ? ativos : modelos) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Fraus MVP',
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, reasoning: { enabled: false } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        ultimoErro = new Error(`${model} -> HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
        if (res.status === 401) throw new Error('OPENROUTER_API_KEY inválida (HTTP 401): gere uma chave nova em openrouter.ai/keys');
        console.warn('[LLM]', ultimoErro.message);
        if (res.status === 429 || res.status === 404 || res.status >= 500) pausar(model, res.status);
        continue; // 429 limite, 404 modelo saiu do ar, 5xx: tenta o próximo
      }
      const data = await res.json();
      const conteudo = data.choices?.[0]?.message?.content?.trim();
      if (!conteudo) {
        ultimoErro = new Error(`${model} -> resposta vazia`);
        continue;
      }
      console.log(`[LLM] respondido por ${data.model || model}`);
      return conteudo;
    } catch (err) {
      if (err.message.startsWith('OPENROUTER_API_KEY')) throw err; // chave errada: não adianta trocar de modelo
      ultimoErro = err;
      console.warn('[LLM]', model, err.name === 'TimeoutError' ? 'timeout' : err.message);
      if (err.name === 'TimeoutError') pausar(model, 503);
    }
  }
  throw ultimoErro || new Error('Nenhum modelo disponível');
}

const INTENTS = ['checar_link', 'checar_mensagem', 'incidente', 'saudacao', 'cpf', 'outro'];

function fallbackClassify(text) {
  const t = text.toLowerCase();
  if (/(cliquei|ca[ií] (no|num|em)|fiz (um )?pix|passei (meus )?dados|roubaram|clonaram|invadiram|perdi (o )?acesso)/.test(t)) return { intent: 'incidente' };
  if (/\bcpf\b/.test(t)) return { intent: 'cpf' };
  if (/(https?:\/\/|www\.|\.com|\.br)/.test(t)) return { intent: 'checar_link' };
  if (/^(oi|ol[aá]|bom dia|boa tarde|boa noite|menu|ajuda)\b/.test(t.trim())) return { intent: 'saudacao' };
  return { intent: 'outro' };
}

export async function classifyMessage(text) {
  const prompt = `Classifique a mensagem do usuário em UMA intenção:
- "checar_link": quer saber se um link ou site é confiável
- "checar_mensagem": quer saber se uma mensagem, ligação, boleto ou pedido é golpe
- "incidente": diz que já caiu em golpe, clicou, passou dados, fez Pix ou perdeu acesso a uma conta
- "cpf": quer verificar ou proteger o próprio CPF, ou acha que estão usando o CPF dele
- "saudacao": cumprimento ou pergunta sobre o que o Fraus faz
- "outro": qualquer outra coisa (dúvidas gerais sobre golpes, segurança etc.)
Responda APENAS com JSON, sem markdown: {"intent":"..."}

Mensagem: """${maskSensitive(text)}"""`;
  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 200, temperature: 0 });
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    return { intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'outro' };
  } catch (err) {
    console.warn('[LLM] classificação falhou, usando palavras-chave:', err.message);
    return fallbackClassify(text);
  }
}

// "contexto" = fatos verificados pelo sistema. A IA só pode tratar isso como verdade.
export async function generateReply(userText, contexto = '', { maxTokens = 400 } = {}) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (contexto) messages.push({ role: 'system', content: `Fatos verificados pelo sistema (trate só isto como fato):\n${contexto}` });
  messages.push({ role: 'user', content: maskSensitive(userText) });
  return callLLM(messages, { maxTokens });
}

// Lê um print/foto: transcreve o texto visível para o resto do pipeline analisar.
export async function lerImagem(base64, mimeType = 'image/jpeg') {
  const prompt = `Um usuário mandou esta imagem para saber se é golpe.
1. Transcreva TODO o texto visível, exatamente como aparece (links, números, nomes, valores, chaves Pix e a linha digitável de boletos).
2. Diga em poucas palavras o que é a imagem (ex.: print de conversa, boleto, SMS, site, comprovante de Pix, e-mail).
Responda APENAS com JSON: {"tipo":"...","texto":"..."}`;
  const raw = await callLLM(
    [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
    ] }],
    { maxTokens: 1500, temperature: 0, modelos: modelosVisao() },
  );
  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    return { tipo: String(parsed.tipo || 'imagem'), texto: String(parsed.texto || '') };
  } catch {
    return { tipo: 'imagem', texto: raw.replace(/```[a-z]*|```/g, '').trim() };
  }
}