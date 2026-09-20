import { sendText } from './whatsapp.js';
import { extractUrl, analisarUrl } from './riskChecks.js';
import { explicarScore } from './llm.js';
import { detectarIntencaoDeIncidente, abrirChecklistDeIncidente, gerarResumoDeCaso } from './incident.js';
import { getConversationState, setConversationState, getCaso } from './store.js';

const MENSAGEM_BOAS_VINDAS = `Oi! Sou o Guardião 🛡️

Estou de olho no seu CPF e posso checar links, mensagens ou ligações suspeitas a qualquer hora.
É só me mandar um link, ou me contar o que aconteceu.`;

export async function handleIncomingMessage({ from, text }) {
  const estado = getConversationState(from);
  const url = extractUrl(text);

  // 1) Usuário mandou um link -> roda a análise de risco completa
  if (url) {
    await sendText(from, 'Peraí, vou checar esse link agora 🔍');
    const resultado = await analisarUrl(url);
    const explicacao = await explicarScore(resultado);
    await sendText(from, explicacao);
    setConversationState(from, { ultimaAnaliseUrl: resultado });
    return;
  }

  // 2) Usuário pede o resumo de um caso já aberto
  if (/resumo/i.test(text) && estado.ultimoCaseId) {
    const caso = getCaso(estado.ultimoCaseId);
    await sendText(from, gerarResumoDeCaso(caso, estado.ultimoCaseId));
    return;
  }

  // 3) Usuário relata um possível incidente -> abre o fluxo guiado
  if (detectarIntencaoDeIncidente(text)) {
    const { caseId, mensagem } = abrirChecklistDeIncidente(from);
    setConversationState(from, { ultimoCaseId: caseId });
    await sendText(from, mensagem);
    return;
  }

  // 4) Nenhum dos casos acima -> mensagem padrão de boas-vindas/ajuda
  await sendText(from, MENSAGEM_BOAS_VINDAS);
}
