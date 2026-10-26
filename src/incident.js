// src/incident.js
// Resposta a incidente: checklist por TIPO de golpe (fixo, não depende da IA)
// + coleta do relato + dossiê pronto para levar ao banco e à delegacia.
import { normalizar, dataHoraBR } from './util.js';
import { abrirCaso } from './store.js';

const GATILHOS = /(cliquei|cai (no|num|em um|nesse|neste) golpe|fui vitima|fiz (um |o )?pix|transferi|mandei (o |um )?pix|paguei (o|um|esse) boleto|passei (a |minha |o |meu )?(senha|codigo|dados)|roubaram|clonaram|hackearam|invadiram|me enganaram|preenchi (os |meus )?dados|perdi (o )?acesso|levaram meu dinheiro|golpe em mim)/;
const NEGACAO = /nao (cliquei|fiz|passei|transferi|paguei|preenchi|cai)/;

export function detectarIntencaoDeIncidente(texto) {
  const t = normalizar(texto);
  return GATILHOS.test(t) && !NEGACAO.test(t);
}

export const BOTOES_TIPO = [
  { id: 'inc_pix', title: '💸 Fiz Pix/pagamento' },
  { id: 'inc_senha', title: '🔑 Passei senha/cód.' },
  { id: 'inc_dados', title: '👆 Cliquei/dei dados' },
];

export const TIPOS = {
  pix: {
    titulo: 'Pix, transferência ou boleto pago a golpista',
    passos: [
      '*Agora:* ligue para o seu banco pelo número do app ou do verso do cartão e peça a abertura do *MED* (Mecanismo Especial de Devolução do Pix). Quanto mais rápido, maior a chance: o dinheiro costuma ser movido em minutos.',
      'Peça também o *bloqueio cautelar* dos valores e *anote o número do protocolo*.',
      'Registre um *boletim de ocorrência online* na Delegacia Eletrônica do seu estado.',
      'Guarde o comprovante, os prints da conversa e a chave Pix do golpista.',
    ],
  },
  senha: {
    titulo: 'Senha, código ou token passado para alguém',
    passos: [
      'Troque *agora* a senha do app do banco e do seu e-mail (e de onde mais usar a mesma senha).',
      'Ligue para o banco pelo número oficial e peça o *bloqueio preventivo* da conta e dos cartões.',
      'Se foi o *código do WhatsApp* (6 dígitos): entre de novo no WhatsApp com o seu número para derrubar o golpista e ative a *confirmação em duas etapas* (Configurações > Conta). Avise seus contatos que alguém pode pedir dinheiro em seu nome.',
      'Registre um *boletim de ocorrência online*.',
    ],
  },
  dados: {
    titulo: 'Clicou em link ou preencheu dados',
    passos: [
      'Se digitou *senha*: troque já, pelo app oficial (nunca pelo link).',
      'Se digitou *dados do cartão*: bloqueie o cartão no app do banco e peça um novo.',
      'Se informou *CPF e dados pessoais*: faça o checkup do CPF (responda *cpf*) e fique atento a contas e empréstimos no seu nome.',
      'Não responda mais ao contato e guarde os prints.',
    ],
  },
  identidade: {
    titulo: 'Uso do CPF sem autorização',
    passos: [
      'Entre em contato com a instituição da conta ou empréstimo que você não reconhece e *conteste* (anote o protocolo).',
      'Registre um *boletim de ocorrência online*: ele é a base para contestar tudo.',
      'Se a dívida aparece na Serasa ou no SPC, use o canal de contestação deles anexando o B.O.',
      'Troque as senhas de e-mail e banco e refaça o checkup em 30 dias.',
    ],
  },
};

export function abrirCasoIncidente(uid, tipo, contexto) {
  return abrirCaso(uid, tipo, { contexto: contexto || null });
}

export function textoChecklist(tipo, caseId) {
  const t = TIPOS[tipo];
  return `Calma, dá para agir. Abri o *caso #${caseId}* para você.
_${t.titulo}_

${t.passos.map((p, i) => `*${i + 1}.* ${p}`).join('\n\n')}

📝 Quando puder, me conta numa mensagem só: *o que aconteceu, quando, o valor* e, se tiver, a *chave Pix, o link ou o número* do golpista. Eu monto um dossiê para você levar ao banco e à delegacia.`;
}

export function gerarDossie(caso, caseId) {
  const t = TIPOS[caso.tipo] || { titulo: caso.tipo, passos: [] };
  const linhas = [
    `📁 *Dossiê do caso #${caseId}*`,
    `_Gerado pelo Fraus em ${dataHoraBR()}_`,
    '',
    `*Tipo:* ${t.titulo}`,
    `*Aberto em:* ${dataHoraBR(caso.criadoEm)}`,
  ];
  if (caso.relato) linhas.push(`*Relato da vítima:* "${caso.relato.slice(0, 700)}"`);
  if (caso.valor) linhas.push(`*Valor mencionado:* ${caso.valor}`);
  if (caso.pix) linhas.push(`*Chave Pix do golpista:* ${caso.pix}`);
  if (caso.links?.length) linhas.push(`*Links envolvidos:* ${caso.links.join(', ')}`);
  if (caso.telefones?.length) linhas.push(`*Telefones envolvidos:* ${caso.telefones.join(', ')}`);
  if (caso.contexto) {
    linhas.push(`*Análise do Fraus antes do incidente:* risco ${caso.contexto.nivel}${caso.contexto.golpe ? ` (${caso.contexto.golpe})` : ''}`);
    if (caso.contexto.achados?.length) linhas.push(caso.contexto.achados.slice(0, 5).map((a) => `  • ${a}`).join('\n'));
  }
  linhas.push('', '*Passos recomendados:*', ...t.passos.map((p, i) => `${i + 1}. ${p.replace(/\*/g, '')}`));
  linhas.push('', 'Encaminhe esta mensagem para o seu banco e anexe ao boletim de ocorrência.');
  return linhas.join('\n');
}
