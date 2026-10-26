// src/patterns.js
// Detector de padrões de golpe em TEXTO, sem IA: regras transparentes e auditáveis.
// A LLM só explica o resultado; quem decide o nível de risco é este módulo.
import { normalizar } from './util.js';

const SINAIS = [
  { id: 'dinheiro', peso: 2, label: 'Pede dinheiro, Pix ou pagamento',
    re: /\bpix\b|transfer|deposit|me empresta|emprestad|pagamento|\bpagar\b|paga (pra|para)|boleto/ },
  { id: 'urgencia', peso: 1, label: 'Cria senso de urgência',
    re: /urgente|urgencia|\bagora\b|\bhoje\b|imediat|rapido|ultim[ao]s? (dia|hora|chance|aviso)|prazo|expira|ainda hoje/ },
  { id: 'troca_numero', peso: 3, label: 'Diz que trocou de número',
    re: /troquei (de )?(numero|celular|chip|whats|zap)|numero novo|novo numero|meu novo (numero|zap|whats|contato)|salva (esse|este|meu) (numero|contato)|esse e meu (novo|numero)/ },
  { id: 'credencial', peso: 3, label: 'Pede senha, código ou token',
    re: /senha|codigo (de|que|enviado|recebido|por sms)|codigo de (seguranca|verificacao)|\btoken\b|\bcvv\b|me (passa|manda|envia) o codigo|informe o codigo/ },
  { id: 'premio', peso: 2, label: 'Promete prêmio ou sorteio',
    re: /voce ganhou|ganhou (um|uma|o|a)\b|premio|sorte(ado|io)|parabens|contemplad|resgat(e|ar) (seu|o)/ },
  { id: 'taxa', peso: 2, label: 'Cobra taxa para liberar algo',
    re: /\btaxa\b|liberar|liberacao|desbloque/ },
  { id: 'ameaca', peso: 2, label: 'Ameaça bloqueio, dívida ou pendência',
    re: /bloquead|bloqueio|suspens|cancelad|irregular|pendencia|negativad|protesto|\bmulta\b|divida|sera (bloqueado|cancelado|suspenso)|retid[ao]/ },
  { id: 'autoridade', peso: 1, label: 'Se apresenta como banco, governo ou empresa',
    re: /central (de|do)|seguranca do banco|gerente|receita federal|\bgov\b|gov\.br|detran|correios|policia|justica|serasa|\binss\b/ },
  { id: 'ganho_facil', peso: 3, label: 'Promete dinheiro fácil',
    re: /renda extra|ganhe (de|ate|r\$)|rendimento garantido|lucro garantido|retorno garantido|dobr(ar|e|a) (seu|o) dinheiro|curtir (videos|posts)|avaliar produtos|tarefas? (simples|faceis)|trabalh(e|ar) de casa/ },
  { id: 'segredo', peso: 2, label: 'Pede segredo',
    re: /nao conta (pra|para)|nao fala (pra|para|com)|segredo|so entre nos/ },
  { id: 'link', peso: 1, label: 'Tem link para clicar',
    re: /https?:\/\/|www\.|clique (no|aqui)|acesse o link|\.com\b|\.br\b/ },
];

const GOLPES = [
  { nome: 'golpe do falso parente ou amigo', se: (s) => s.troca_numero && s.dinheiro },
  { nome: 'golpe da falsa central de atendimento', se: (s) => s.credencial && (s.autoridade || s.ameaca) },
  { nome: 'golpe do falso prêmio', se: (s) => s.premio && (s.taxa || s.dinheiro || s.link) },
  { nome: 'golpe da falsa entrega', se: (s, t) => /encomenda|entrega|rastreio|pacote|correios/.test(t) && (s.taxa || s.dinheiro || s.link) },
  { nome: 'golpe da renda fácil ou falsa vaga', se: (s) => s.ganho_facil },
  { nome: 'falsa cobrança ou falso aviso de pendência', se: (s) => s.ameaca && (s.dinheiro || s.link) },
];

export const DICAS = {
  'golpe do falso parente ou amigo': 'Antes de qualquer coisa, ligue para o número *antigo* da pessoa ou faça uma pergunta que só ela saberia responder. Não transfira nada antes disso.',
  'golpe da falsa central de atendimento': 'Banco nenhum pede senha ou código por mensagem. Desligue e ligue você mesmo para o número do verso do cartão.',
  'golpe do falso prêmio': 'Prêmio de verdade não cobra taxa antecipada. Não pague nada e bloqueie o contato.',
  'golpe da falsa entrega': 'Não clique no link. Consulte a entrega digitando o site oficial no navegador ou pelo app da loja.',
  'golpe da renda fácil ou falsa vaga': 'Empresa séria não cobra para contratar nem promete ganho fácil. Não deposite nada.',
  'falsa cobrança ou falso aviso de pendência': 'Não pague pelo link ou boleto recebido. Confira a dívida direto no site ou app oficial da empresa.',
  alto: 'Não clique, não pague e não passe dados. Confirme por outro canal oficial antes de qualquer coisa.',
  medio: 'Tem sinais de alerta. Se envolver dinheiro ou dados, confirme com a pessoa ou empresa por outro canal antes de agir.',
  baixo: 'Não encontrei sinais claros de golpe, mas isso não é garantia. Desconfie de qualquer pedido de dinheiro, senha ou código.',
};

export function analisarTexto(texto = '') {
  const t = normalizar(texto).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' email ');
  const ativos = {};
  const sinais = [];
  let score = 0;
  for (const s of SINAIS) {
    if (s.re.test(t)) {
      ativos[s.id] = true;
      score += s.peso;
      sinais.push(s.label);
    }
  }
  const golpe = GOLPES.find((g) => g.se(ativos, t))?.nome || null;
  const nivel = golpe || score >= 6 ? 'alto' : score >= 3 ? 'medio' : 'baixo';
  return { nivel, golpe, sinais, score };
}
