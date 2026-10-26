// src/entities.js
// Extrai do texto o que dá para verificar: links, chave Pix, CPF/CNPJ, telefones, boleto e valores.
import { soDigitos } from './util.js';
import { extrairCnpjs } from './cnpj.js';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const TLDS = 'com|net|org|br|info|xyz|top|online|site|shop|app|link|io|me|club|live|click|store|vip|icu|buzz|cc|co|ly|gl|gy|gd|at|sbs|cfd|rest|fun|space|website|pw|tk|ml|ga|cf|gq|lol|monster|quest|cyou|beauty|ai';
const URL_RE = new RegExp(`\\b(?:https?:\\/\\/|www\\.)[^\\s<>"'()]+|\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?:\\/[^\\s<>"'()]*)?`, 'gi');
const LINHA_RE = /\d[\d.\s-]{38,70}\d/g;

export function cpfValido(valor) {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function extrairUrls(texto = '') {
  const limpo = texto.replace(EMAIL, ' ');
  const urls = (limpo.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?)]+$/, ''));
  return [...new Set(urls)];
}

export function extrairLinhaDigitavel(texto = '') {
  for (const trecho of texto.match(LINHA_RE) || []) {
    const d = soDigitos(trecho);
    if ([44, 47, 48].includes(d.length)) return d;
  }
  return null;
}

export function extrairChavePix(texto = '') {
  if (!/\bpix\b/i.test(texto)) return null;
  const email = texto.match(EMAIL);
  if (email) return { tipo: 'email', chave: email[0].toLowerCase() };
  const uuid = texto.match(UUID);
  if (uuid) return { tipo: 'aleatória', chave: uuid[0].toLowerCase() };
  const cnpj = extrairCnpjs(texto)[0];
  if (cnpj) return { tipo: 'cnpj', chave: cnpj };
  const m = texto.match(/(?:chave|pix)[^\d+]{0,25}(\+?[\d\s().-]{10,20}\d)/i);
  if (m) {
    const d = soDigitos(m[1]);
    if (d.length === 11 && cpfValido(d)) return { tipo: 'cpf', chave: d };
    if (d.length >= 10 && d.length <= 13) return { tipo: 'telefone', chave: d.replace(/^55(?=\d{10,11}$)/, '') };
  }
  return null;
}

export function mascararChave({ tipo, chave }) {
  if (tipo === 'email') return chave.replace(/^(.{2}).*(@.*)$/, '$1***$2');
  if (tipo === 'cpf') return `***.${chave.slice(3, 6)}.${chave.slice(6, 9)}-**`;
  if (tipo === 'telefone') return `(${chave.slice(0, 2)}) *****-${chave.slice(-4)}`;
  if (tipo === 'cnpj') return chave.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return `${chave.slice(0, 8)}…`;
}

export function extrairTelefones(texto = '') {
  const re = /(?:\+?55[\s-]?)?\(?\b([1-9]{2})\)?[\s-]?(9?\d{4})[\s-]?(\d{4})\b/g;
  const achados = new Set();
  for (const m of texto.matchAll(re)) {
    const d = m[1] + m[2] + m[3];
    if (d.length === 11 && cpfValido(d)) continue; // provavelmente é CPF
    achados.add(d);
  }
  return [...achados];
}

export function extrairValor(texto = '') {
  const m = texto.match(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/i);
  return m ? `R$ ${m[1]}` : null;
}

// Tudo de uma vez, sem confundir boleto com telefone nem CNPJ com chave Pix.
export function extrairEntidades(texto = '') {
  const linha = extrairLinhaDigitavel(texto);
  const resto = linha ? texto.replace(LINHA_RE, ' ') : texto;
  const pix = extrairChavePix(resto);
  const urls = extrairUrls(resto).slice(0, 2);
  const cnpjs = extrairCnpjs(resto).filter((c) => !(pix?.tipo === 'cnpj' && pix.chave === c)).slice(0, 1);
  const telefones = extrairTelefones(resto.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' '))
    .filter((t) => !(pix && pix.chave === t)).slice(0, 2);
  const total = urls.length + cnpjs.length + telefones.length + (pix ? 1 : 0) + (linha ? 1 : 0);
  return { linha, pix, urls, cnpjs, telefones, total };
}
