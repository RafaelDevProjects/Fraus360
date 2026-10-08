import { abrirCaso } from './store.js';

// Palavras-chave simples para detectar intenção de reportar um incidente.
// Isso é uma primeira heurística - o ideal é migrar para classificação via LLM
// assim que o volume de mensagens justificar (cobre mais variações de linguagem).
const PALAVRAS_INCIDENTE = [
  'cliquei',
  'caí no golpe',
  'fui vítima',
  'roubaram meus dados',
  'me enganaram',
  'preencheram meus dados',
  'acho que é golpe e eu cliquei',
];

export function detectarIntencaoDeIncidente(texto) {
  const normalizado = texto.toLowerCase();
  return PALAVRAS_INCIDENTE.some((p) => normalizado.includes(p));
}

export function abrirChecklistDeIncidente(telefone) {
  const caseId = abrirCaso(telefone, 'incidente_generico', {});

  const mensagem = `Entendido, sem pânico — vamos resolver isso juntos agora.

*Caso #${caseId} aberto*

Próximos passos, nesta ordem:
1. Troque a senha do app do banco agora, antes de qualquer outra coisa
2. Ligue para o banco pelo número oficial (nunca pelo link) e avise que houve phishing
3. Ative o bloqueio preventivo do seu CPF para novas contas/crédito
4. Guarde o print da mensagem e do link como evidência

Quer que eu monte um resumo desse caso pra você levar ao banco ou à polícia? É só responder "resumo".`;

  return { caseId, mensagem };
}

export function gerarResumoDeCaso(caso, caseId) {
  const agora = new Date().toLocaleString('pt-BR');
  return `*Resumo do caso #${caseId}*

• O que aconteceu: possível exposição de dados após clique em link suspeito
• Quando: ${agora}
• Pendente: confirmar troca de senha e contato com o banco

Esse resumo fica salvo aqui. Se precisar, é só pedir "resumo do caso" de novo a qualquer momento.`;
}