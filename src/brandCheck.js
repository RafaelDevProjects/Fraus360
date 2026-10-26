// src/brandCheck.js
// Análise local do endereço (sem API): detecta sites que se passam por marcas conhecidas,
// letras trocadas por números (banc0, ltau), encurtadores, IP no lugar de domínio etc.
// Pega golpes NOVOS, que ainda não estão em nenhuma lista de phishing.

const MARCAS = [
  ['Itaú', ['itau'], ['itau.com.br', 'itau.com', 'itaupersonnalite.com.br']],
  ['Bradesco', ['bradesco'], ['bradesco.com.br', 'bradesco', 'bradescoseguros.com.br']],
  ['Santander', ['santander'], ['santander.com.br', 'santander.com']],
  ['Caixa', ['caixa'], ['caixa.gov.br']],
  ['Banco do Brasil', ['bancodobrasil'], ['bb.com.br']],
  ['Nubank', ['nubank'], ['nubank.com.br', 'nu.com.br']],
  ['Banco Inter', ['bancointer'], ['bancointer.com.br', 'inter.co']],
  ['C6 Bank', ['c6bank'], ['c6bank.com.br']],
  ['PicPay', ['picpay'], ['picpay.com']],
  ['Mercado Livre', ['mercadolivre', 'mercadolibre'], ['mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com']],
  ['Mercado Pago', ['mercadopago'], ['mercadopago.com.br', 'mercadopago.com']],
  ['Correios', ['correios'], ['correios.com.br']],
  ['Receita Federal', ['receitafederal'], ['gov.br']],
  ['Serasa', ['serasa'], ['serasa.com.br', 'serasaexperian.com.br']],
  ['Shopee', ['shopee'], ['shopee.com.br', 'shopee.com']],
  ['Magalu', ['magalu', 'magazineluiza'], ['magazineluiza.com.br', 'magalu.com']],
  ['Americanas', ['americanas'], ['americanas.com.br']],
  ['Amazon', ['amazon'], ['amazon.com.br', 'amazon.com']],
  ['Netflix', ['netflix'], ['netflix.com']],
  ['WhatsApp', ['whatsapp'], ['whatsapp.com', 'whatsapp.net']],
  ['Instagram', ['instagram'], ['instagram.com']],
  ['Detran', ['detran'], ['gov.br']],
  ['INSS', ['meuinss', 'inss'], ['gov.br']],
];

export const ENCURTADORES = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 't.co', 'rb.gy', 'shorturl.at',
  'encurtador.com.br', 'abre.ai', 'tiny.cc', 'ow.ly', 's.id', 't.ly', 'short.gy', 'l.ead.me', 'encr.pw'];

const TLDS_SUSPEITOS = ['xyz', 'top', 'click', 'online', 'site', 'shop', 'live', 'icu', 'buzz', 'rest', 'cfd', 'sbs',
  'store', 'vip', 'lol', 'monster', 'quest', 'beauty', 'cyou', 'fun', 'space', 'website', 'pw', 'tk', 'ml', 'ga', 'cf', 'gq'];

const PALAVRAS_ISCA = /(login|seguranca|atualiza|regulariza|premio|resgat|bonus|cpf|desbloque|confirma|verifica|suporte|central|promo|sorteio|ganhe|gratis|indeniza|restituic|taxa|boleto|fatura|acordo|limpanome)/;

const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

const ehDoDominio = (host, dom) => host === dom || host.endsWith(`.${dom}`);
export const ehEncurtador = (host = '') => ENCURTADORES.some((d) => ehDoDominio(host, d));

export function analisarDominio(hostOriginal = '') {
  const host = String(hostOriginal).toLowerCase().replace(/^www\./, '');
  const motivos = [];
  let pontos = 0;
  if (!host) return { pontos, motivos };

  const semSep = host.replace(/[.\-_]/g, '');
  const leet = semSep.replace(/[013457@$]/g, (c) => LEET[c]);
  const parecido = (s) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/l/g, 'i');

  // 1. Imita uma marca conhecida, mas não é o domínio oficial
  for (const [nome, tokens, oficiais] of MARCAS) {
    if (oficiais.some((d) => ehDoDominio(host, d))) continue;
    const token = tokens.find((tk) => leet.includes(tk) || parecido(leet).includes(parecido(tk)));
    if (!token) continue;
    pontos += 55;
    motivos.push(`Usa o nome *${nome}*, mas não é o site oficial`);
    if (!semSep.includes(token)) {
      pontos += 15;
      motivos.push('Troca letras por números ou caracteres parecidos para enganar (ex.: "banc0", "ltau")');
    }
    break;
  }

  // 2. Finge ser do governo sem terminar em .gov.br
  if (/(^|[.-])gov([.-]|br|$)|govbr/.test(host) && !host.endsWith('.gov.br') && host !== 'gov.br') {
    pontos += 50;
    motivos.push('Usa "gov" no endereço, mas site do governo sempre termina em *.gov.br*');
  }

  if (host.startsWith('xn--') || host.includes('.xn--')) {
    pontos += 25;
    motivos.push('Usa caracteres especiais que imitam letras normais');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    pontos += 35;
    motivos.push('O link é um número (IP), não um site com nome: típico de golpe');
  }
  if (ehEncurtador(host)) {
    pontos += 10;
    motivos.push('Link encurtado esconde o destino real');
  }
  const tld = host.split('.').pop();
  if (TLDS_SUSPEITOS.includes(tld)) {
    pontos += 10;
    motivos.push(`Termina em ".${tld}", extensão muito usada em golpes`);
  }
  if (PALAVRAS_ISCA.test(semSep) && pontos > 0) {
    pontos += 10;
    motivos.push('Tem palavras-isca no endereço (ex.: "regulariza", "premio", "login")');
  }
  if ((host.match(/-/g) || []).length >= 3) {
    pontos += 5;
    motivos.push('Endereço longo, cheio de hífens');
  }

  return { pontos, motivos };
}

// Domínio "registrável" para consultar RDAP: "app.banco.com.br" -> "banco.com.br"
export function dominioRegistravel(host = '') {
  const p = host.toLowerCase().replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  const sld = ['com', 'net', 'org', 'gov', 'edu', 'art', 'blog', 'app', 'dev', 'eco', 'emp', 'ind', 'inf', 'log', 'tec', 'tur', 'vet', 'nom', 'adv', 'eng', 'med'];
  return p.at(-1) === 'br' && sld.includes(p.at(-2)) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
