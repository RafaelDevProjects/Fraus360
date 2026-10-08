// src/llm.js
// Integração com o OpenRouter (API compatível com OpenAI).
// Usa modelos gratuitos (:free) com fallback automático entre eles.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Lista de modelos em ordem de preferência, separados por vírgula no .env.
// "openrouter/free" é o roteador que escolhe um modelo gratuito disponível.
const MODELS = (process.env.OPENROUTER_MODELS || 'openrouter/free')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const SYSTEM_PROMPT = `Você é o Guardião, um assistente antifraude brasileiro que conversa pelo WhatsApp.
Regras:
- Responda em português do Brasil, curto e claro (no máximo 6 linhas), com tom calmo e acolhedor.
- Nunca peça senha, código de cartão, token ou código de verificação ao usuário.
- Nunca afirme com certeza que algo é seguro; diga apenas o que foi verificado.
- Se não souber, diga que não sabe e recomende o canal oficial da empresa.
- Nunca invente números de telefone, sites ou nomes de canais oficiais.
- Não use markdown com # ou tabelas; o WhatsApp só aceita *negrito* e _itálico_.`;

// Remove CPF e números de cartão antes de mandar texto para a LLM.
// Modelos gratuitos podem registrar os prompts, então dado pessoal não sai daqui.
function maskSensitive(text = '') {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[CARTAO]');
}

async function callLLM(messages, { maxTokens = 400, temperature = 0.3 } = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY não definida no .env');
  }

  let lastError;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000); // 20s por modelo

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Guardiao MVP',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          // Desliga o "raciocínio" em modelos que pensam antes de responder:
          // ele consome tokens e deixa a resposta lenta. Modelos sem reasoning ignoram.
          reasoning: { enabled: false },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        lastError = new Error(`${model} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
        console.warn('[LLM]', lastError.message);
        continue; // 429 (limite), 404 (modelo saiu do ar), 5xx: tenta o próximo
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content && data.choices?.[0]?.message?.reasoning) {
        console.warn(`[LLM] ${model} gastou os tokens raciocinando e não respondeu`);
      }
      if (!content) {
        lastError = new Error(`${model} -> resposta vazia`);
        continue;
      }

      console.log(`[LLM] respondido por ${data.model || model}`);
      return content;
    } catch (err) {
      lastError = err;
      console.warn('[LLM]', model, err.name === 'AbortError' ? 'timeout' : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Nenhum modelo disponível');
}

const INTENTS = ['checar_link', 'checar_mensagem', 'incidente', 'saudacao', 'outro'];

// Classificação por palavras-chave, usada se a LLM falhar ou estourar o limite.
function fallbackClassify(text) {
  const t = text.toLowerCase();
  if (/(cliquei|ca[ií] (no|num|em)|fiz (um )?pix|passei (meus )?dados|roubaram|clonaram|invadiram|perdi (o )?acesso)/.test(t)) {
    return { intent: 'incidente', urgencia: 'alta' };
  }
  if (/(https?:\/\/|www\.|\.com|\.br)/.test(t)) return { intent: 'checar_link', urgencia: 'media' };
  if (/^(oi|ol[aá]|bom dia|boa tarde|boa noite|menu|ajuda)\b/.test(t.trim())) {
    return { intent: 'saudacao', urgencia: 'baixa' };
  }
  return { intent: 'checar_mensagem', urgencia: 'media' };
}

async function classifyMessage(text) {
  const prompt = `Classifique a mensagem do usuário em UMA intenção:
- "checar_link": quer saber se um link ou site é confiável
- "checar_mensagem": quer saber se uma mensagem, ligação ou pedido é golpe
- "incidente": diz que já caiu em golpe, clicou, passou dados, fez Pix ou perdeu acesso a conta
- "saudacao": cumprimento ou pergunta sobre o que o Guardião faz
- "outro": qualquer outra coisa
Se a pessoa mandou um link E disse que já clicou ou passou dados, escolha "incidente".
Responda APENAS com JSON, sem markdown: {"intent":"...","urgencia":"baixa|media|alta"}

Mensagem: """${maskSensitive(text)}"""`;

  try {
    const raw = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 200, temperature: 0 });
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'outro',
      urgencia: ['baixa', 'media', 'alta'].includes(parsed.urgencia) ? parsed.urgencia : 'media',
    };
  } catch (err) {
    console.warn('[LLM] classificação falhou, usando palavras-chave:', err.message);
    return fallbackClassify(text);
  }
}

// Gera a resposta final. "context" são fatos verificados pelo sistema
// (futuramente: resultado do Safe Browsing, WHOIS etc.).
async function generateReply(userText, context = '') {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (context) {
    messages.push({
      role: 'system',
      content: `Dados verificados pelo sistema (trate apenas isto como fato):\n${context}`,
    });
  }
  messages.push({ role: 'user', content: maskSensitive(userText) });
  return callLLM(messages);
}

export { callLLM, classifyMessage, generateReply, maskSensitive };