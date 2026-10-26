// src/cnpj.js
// Consulta de CNPJ na BrasilAPI (gratuita, dados da Receita Federal).
// Responde "essa loja/empresa existe, está ativa e há quanto tempo?" antes de pagar.
import { soDigitos, fetchJson, diasDesde, dataBR, tempoRelativo } from './util.js';

export function cnpjValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = (base, pesos) => {
    const r = pesos.reduce((soma, p, i) => soma + Number(base[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(c[12])
    && dv(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(c[13]);
}

export const formatarCnpj = (c) =>
  soDigitos(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export function extrairCnpjs(texto = '') {
  const achados = texto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || [];
  return [...new Set(achados.map(soDigitos).filter((c) => c.length === 14))];
}

export async function consultarCnpj(cnpj) {
  const c = soDigitos(cnpj);
  const base = { cnpj: c, rotulo: formatarCnpj(c) };
  if (!cnpjValido(c)) {
    return { ...base, disponivel: true, nivel: 'alto', resumo: null,
      motivos: ['CNPJ com dígitos inválidos: não existe ou foi digitado errado'] };
  }
  try {
    const { status, data } = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${c}`, { timeout: 10000 });
    if (status === 404) {
      return { ...base, disponivel: true, nivel: 'alto', resumo: null, motivos: ['CNPJ não encontrado na Receita Federal'] };
    }
    if (!data?.razao_social) return { ...base, disponivel: false, nivel: 'baixo', motivos: [], resumo: null };

    const situacao = String(data.descricao_situacao_cadastral || '').toUpperCase();
    const idade = diasDesde(data.data_inicio_atividade);
    const motivos = [];
    let nivel = 'baixo';
    if (situacao && situacao !== 'ATIVA') {
      nivel = 'alto';
      motivos.push(`Situação na Receita: *${situacao}* (não está ativa)`);
    }
    if (idade != null && idade < 180) {
      if (nivel === 'baixo') nivel = 'medio';
      motivos.push(`Empresa aberta há só ${tempoRelativo(idade)}`);
    }
    const nome = data.nome_fantasia ? `${data.razao_social} (${data.nome_fantasia})` : data.razao_social;
    const partes = [nome, situacao || null,
      data.data_inicio_atividade ? `aberta em ${dataBR(data.data_inicio_atividade)}` : null,
      data.municipio ? `${data.municipio}/${data.uf}` : null,
      data.opcao_pelo_mei ? 'MEI' : null].filter(Boolean);
    return { ...base, disponivel: true, nivel, motivos, resumo: partes.join(' · '), razaoSocial: data.razao_social };
  } catch (err) {
    console.warn('[CNPJ] BrasilAPI indisponível:', err.message);
    return { ...base, disponivel: false, nivel: 'baixo', motivos: [], resumo: null };
  }
}
