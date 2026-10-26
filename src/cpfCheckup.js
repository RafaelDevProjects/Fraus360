// src/cpfCheckup.js
// Checkup de CPF GUIADO e gratuito: o Fraus não pede nem guarda o CPF.
// A pessoa consulta as fontes oficiais (Registrato do Banco Central e Serasa) e diz o que achou.
// Se achar algo estranho, vira um caso de incidente. Lembrete a cada 30 dias.
import { diasDesde } from './util.js';

export const TEXTO = `🪪 *Checkup gratuito do seu CPF*

Leva uns 10 minutos. Eu *não* peço seu CPF: você consulta direto nos sites oficiais e me conta o que encontrou.

*1. Registrato (Banco Central)*
Entre em registrato.bcb.gov.br com a sua conta gov.br (nível prata ou ouro) e veja:
• *Empréstimos e financiamentos*: tem algum que você não fez?
• *Contas e relacionamentos*: tem conta em banco que você não abriu?
• *Chaves Pix*: tem chave Pix que não é sua?

*2. Serasa*
No app ou site da Serasa, veja se existe dívida no seu nome que você não reconhece. Consultar o próprio CPF é gratuito.

Quando terminar, me diga o que encontrou 👇`;

export const BOTOES = [
  { id: 'cpf_ok', title: '✅ Reconheço tudo' },
  { id: 'cpf_estranho', title: '⚠️ Achei algo errado' },
  { id: 'cpf_depois', title: '⏰ Faço depois' },
];

export const TEXTO_OK = `Ótimo, tudo certo com o seu CPF ✅
Daqui a 30 dias, na próxima vez que você falar comigo, eu te lembro de refazer o checkup. Fraude de identidade costuma aparecer aos poucos, então a rotina é o que protege.`;

export const TEXTO_DEPOIS = 'Combinado! Quando quiser, é só mandar *cpf* que eu te mostro o passo a passo de novo.';

// Devolve um lembrete (uma vez a cada 30 dias) se o último checkup ficou velho.
export function lembrete(estado) {
  const dias = diasDesde(estado.ultimoCheckupCpf);
  if (dias == null || dias < 30) return null;
  const ultimo = diasDesde(estado.lembreteCheckupEm);
  if (ultimo != null && ultimo < 30) return null;
  return `\n\n🪪 _Faz ${dias} dias do seu último checkup de CPF. Responda *cpf* para refazer._`;
}
