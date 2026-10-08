// src/messageHandler.js
// Recebe uma mensagem do webhook, decide a intenção e responde.
// Link  -> analisarUrl (4 fontes) calcula o Trust Score; a LLM só EXPLICA o resultado.
// Incidente -> checklist fixo + caso aberto no store (não depende da LLM).

import { classifyMessage, generateReply } from './llm.js';
import { sendText } from './whatsappSend.js';
import { analisarUrl } from './riskChecks.js';
import {
  detectarIntencaoDeIncidente,
  abrirChecklistDeIncidente,
  gerarResumoDeCaso,
} from './incident.js';
import { getConversationState, setConversationState, getCaso } from './store.js';

// A Meta pode reenviar o mesmo evento; guardamos os IDs já processados.
const processed = new Set();

const MENU = `Oi! Eu sou o *Guardião* 🛡️
Posso te ajudar a:
• Checar se um *link* é golpe (é só me mandar)
• Analisar uma *mensagem* ou ligação suspeita (cole o texto aqui)
• Te guiar se você *já caiu* em algum golpe

O que você precisa agora?`;

function extractUrls(text) {
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|br|info|xyz|top|online|site|shop|app|link|io|me)(?:\/[^\s<>"']*)?/gi;
  return [...new Set(text.match(re) || [])];
}

// O analisador usa new URL(), que exige o protocolo. "banco.com" vira "https://banco.com".
function normalizarUrl(u) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// Decide a intenção gastando o mínimo de chamadas à LLM (o plano grátis tem limite diário).
async function decidirIntencao(text, urls) {
  if (detectarIntencaoDeIncidente(text)) return 'incidente';
  if (urls.length) return 'checar_link'; // link sem relato de clique: não precisa de LLM
  const { intent } = await classifyMessage(text);
  return intent;
}

function explicacaoSemLLM(r) {
  if (r.motivos.length) {
    return `Encontrei estes sinais de alerta:\n${r.motivos.map((m) => `• ${m}`).join('\n')}\n\nRecomendo não clicar nem preencher nenhum dado.`;
  }
  return 'Nenhuma das bases que consultei sinalizou esse link, mas golpes novos podem ainda não estar catalogados. Na dúvida, não preencha dados e acesse o site digitando o endereço oficial.';
}

async function responderAnaliseDeLink(from, rawUrl) {
  const url = normalizarUrl(rawUrl);
  const r = await analisarUrl(url);
  setConversationState(from, { ultimaUrlAnalisada: url, ultimoScore: r.score });

  const fontes = Object.values(r.detalhes);
  const consultadas = fontes.filter((f) => f.disponivel).length;
  const vtPendente = r.detalhes.virusTotal?.status === 'pendente_primeira_analise';

  // Nível "baixo" NÃO significa seguro: significa que nenhuma base conhecida sinalizou.
  const rotulos = {
    alto: '🔴 RISCO ALTO',
    medio: '🟠 RISCO MÉDIO',
    baixo: '🟢 NENHUM ALERTA ENCONTRADO',
  };
  const cabecalho =
    consultadas === 0
      ? '⚪ *Não consegui verificar esse link agora*'
      : `*Trust Score: ${r.score}/100* · ${rotulos[r.nivel]}`;

  const contexto = `Resultado da verificação do link ${url}:
- Trust Score: ${r.score}/100 (nível ${r.nivel}); quanto maior, mais arriscado
- Fontes consultadas com sucesso: ${consultadas} de ${fontes.length}
- Motivos encontrados: ${r.motivos.length ? r.motivos.join('; ') : 'nenhum'}
${vtPendente ? '- O VirusTotal ainda não tinha analisado este link antes.\n' : ''}
Instruções: explique o resultado em até 4 linhas, sem repetir o número do score.
Se o nível for baixo, NÃO diga que é seguro: diga que nenhuma base conhecida sinalizou o link,
mas que golpes novos podem ainda não estar catalogados, e aponte sinais de alerta visíveis no
próprio endereço (letras trocadas, nome de banco em domínio estranho, promessa de prêmio).
Termine com uma recomendação prática.`;

  let explicacao;
  try {
    explicacao = await generateReply(`Verifique este link: ${url}`, contexto);
  } catch (err) {
    console.warn('[handler] LLM indisponível, usando explicação padrão:', err.message);
    explicacao = explicacaoSemLLM(r);
  }

  return `${cabecalho}\n\n${explicacao}\n\nSe você já clicou ou preencheu algum dado, me responda *cliquei* que eu te ajudo agora.`;
}

async function handleIncomingMessage(msg) {
  if (processed.has(msg.id)) return;
  processed.add(msg.id);
  if (processed.size > 5000) processed.clear();

  const from = msg.from;

  try {
    if (msg.type !== 'text') {
      await sendText(from, 'Por enquanto eu só leio mensagens de texto. Me manda o link ou cole aqui o texto da mensagem suspeita.');
      return;
    }

    const text = msg.text.body.trim();
    const estado = getConversationState(from);

    // Comando direto, sem gastar LLM: resumo do caso aberto.
    if (/^resumo/i.test(text) && estado.caseId) {
      await sendText(from, gerarResumoDeCaso(getCaso(estado.caseId), estado.caseId));
      return;
    }

    const urls = extractUrls(text);
    const intent = await decidirIntencao(text, urls);
    console.log(`[handler] ${from} -> intent=${intent} urls=${urls.length}`);

    let reply;
    switch (intent) {
      case 'saudacao':
        reply = MENU;
        break;

      case 'incidente': {
        if (estado.estado === 'incidente' && estado.caseId) {
          reply = `Seu caso *#${estado.caseId}* continua aberto. Seguiu os passos que te mandei? Responda *resumo* para ver o resumo do caso.`;
          break;
        }
        const { caseId, mensagem } = abrirChecklistDeIncidente(from);
        setConversationState(from, { estado: 'incidente', caseId });
        reply = mensagem;
        break;
      }

      case 'checar_link':
        reply = urls.length
          ? await responderAnaliseDeLink(from, urls[0])
          : 'Me manda o link completo que você recebeu que eu dou uma olhada.';
        break;

      default:
        reply = await generateReply(text);
    }

    await sendText(from, reply);
  } catch (err) {
    console.error('[handler] erro:', err.message);
    try {
      await sendText(from, 'Tive um problema técnico agora 😕 Tenta de novo em um minuto. Se for urgente, ligue para o seu banco pelo número do verso do cartão.');
    } catch (_) {
      /* se nem isso funcionou, provavelmente é o token do WhatsApp */
    }
  }
}

export { handleIncomingMessage, extractUrls };