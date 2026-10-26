// src/boleto.js
// Valida a linha digitável de boletos (cálculo local, sem API).
// Dígito verificador errado = código digitado errado OU adulterado: não pague sem confirmar.
import { soDigitos, fetchJson, dataBR, moedaBR } from './util.js';

const BANCOS = {
  '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa Econômica Federal', '237': 'Bradesco',
  '341': 'Itaú Unibanco', '260': 'Nu Pagamentos (Nubank)', '077': 'Banco Inter', '336': 'C6 Bank',
  '212': 'Banco Original', '756': 'Sicoob', '748': 'Sicredi', '422': 'Banco Safra', '290': 'PagSeguro (PagBank)',
  '323': 'Mercado Pago', '380': 'PicPay', '197': 'Stone', '208': 'BTG Pactual', '041': 'Banrisul',
  '070': 'BRB', '004': 'Banco do Nordeste',
};

const SEGMENTOS = { 1: 'Prefeitura', 2: 'Saneamento', 3: 'Energia elétrica e gás', 4: 'Telecomunicações',
  5: 'Órgão governamental', 6: 'Empresas e carnês', 7: 'Multa de trânsito', 9: 'Uso exclusivo do banco' };

export function mod10(n) {
  let soma = 0;
  let peso = 2;
  for (let i = n.length - 1; i >= 0; i--) {
    let p = Number(n[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function somaMod11(n) {
  let soma = 0;
  let peso = 2;
  for (let i = n.length - 1; i >= 0; i--) {
    soma += Number(n[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma;
}

export function mod11Bancario(n) {
  const dv = 11 - (somaMod11(n) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

function mod11Arrecadacao(n) {
  const r = somaMod11(n) % 11;
  return r <= 1 ? 0 : 11 - r;
}

// O "fator de vencimento" reiniciou em 22/02/2025 (fator 1000 = 22/02/2025).
function vencimentoPorFator(fator) {
  const f = Number(fator);
  if (!f) return null;
  return new Date(Date.UTC(2025, 1, 22) + (f - 1000) * 86400000);
}

async function nomeDoBanco(codigo) {
  if (BANCOS[codigo]) return BANCOS[codigo];
  try {
    const { data } = await fetchJson(`https://brasilapi.com.br/api/banks/v1/${Number(codigo)}`, { timeout: 5000 });
    return data?.name || data?.fullName || `banco ${codigo}`;
  } catch {
    return `banco ${codigo}`;
  }
}

async function montarBancario({ valido, banco, fator, valorStr }) {
  const valor = Number(valorStr) / 100;
  const venc = vencimentoPorFator(fator);
  const bancoNome = await nomeDoBanco(banco);
  const motivos = [];
  let nivel = 'baixo';
  if (!valido) {
    nivel = 'alto';
    motivos.push('Os dígitos verificadores *não batem*: o código foi digitado errado ou foi *adulterado*');
  }
  if (venc && venc.getTime() < Date.now() - 86400000) {
    if (nivel === 'baixo') nivel = 'medio';
    motivos.push(`Boleto vencido em ${dataBR(venc)}: cobrança antiga reenviada pode ser golpe`);
  }
  const resumo = [`emitido por *${bancoNome}*`, valor ? `valor ${moedaBR(valor)}` : 'sem valor definido',
    venc ? `vencimento ${dataBR(venc)}` : null].filter(Boolean).join(' · ');
  return { tipo: 'bancario', valido, bancoCodigo: banco, banco: bancoNome, valor, vencimento: venc, nivel, motivos, resumo };
}

export async function analisarBoleto(codigo) {
  const d = soDigitos(codigo);

  if (d.length === 47) {
    const campos = [[0, 9], [10, 20], [21, 31]];
    const camposOk = campos.every(([ini, fim]) => mod10(d.slice(ini, fim)) === Number(d[fim]));
    const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    const geralOk = mod11Bancario(barras.slice(0, 4) + barras.slice(5)) === Number(barras[4]);
    return montarBancario({ valido: camposOk && geralOk, banco: d.slice(0, 3), fator: d.slice(33, 37), valorStr: d.slice(37, 47) });
  }

  if (d.length === 44 && d[0] !== '8') {
    const valido = mod11Bancario(d.slice(0, 4) + d.slice(5)) === Number(d[4]);
    return montarBancario({ valido, banco: d.slice(0, 3), fator: d.slice(5, 9), valorStr: d.slice(9, 19) });
  }

  if (d.length === 48 && d[0] === '8') {
    const id = d[2];
    const calc = id === '6' || id === '7' ? mod10 : mod11Arrecadacao;
    const blocos = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 12));
    const valido = blocos.every((b) => calc(b.slice(0, 11)) === Number(b[11]));
    const barras = blocos.map((b) => b.slice(0, 11)).join('');
    const valor = id === '6' || id === '8' ? Number(barras.slice(4, 15)) / 100 : 0;
    const segmento = SEGMENTOS[d[1]] || 'Convênio';
    return {
      tipo: 'arrecadacao', valido, valor, segmento,
      nivel: valido ? 'baixo' : 'medio',
      motivos: valido ? [] : ['Os dígitos verificadores não batem: confira se digitou certo antes de pagar'],
      resumo: [`conta de consumo/tributo (${segmento})`, valor ? `valor ${moedaBR(valor)}` : null].filter(Boolean).join(' · '),
    };
  }

  return null;
}
