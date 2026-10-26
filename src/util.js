// src/util.js
// Funções pequenas usadas em vários módulos.
import crypto from 'node:crypto';

export const soDigitos = (s = '') => String(s).replace(/\D/g, '');

// Minúsculas e sem acento: "Caí no Golpe" -> "cai no golpe"
export function normalizar(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Identificador anônimo (LGPD): guardamos o hash do telefone, nunca o número.
export function hashId(valor) {
  const salt = process.env.HASH_SALT || 'fraus-dev-salt';
  return crypto.createHash('sha256').update(`${salt}:${valor}`).digest('hex').slice(0, 24);
}

export async function fetchJson(url, { timeout = 8000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'fraus-mvp/0.2', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* resposta sem JSON */
  }
  return { status: res.status, ok: res.ok, data };
}

export function diasDesde(dataIso) {
  const t = Date.parse(dataIso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

export function dataBR(data) {
  return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function dataHoraBR(data = new Date()) {
  return new Date(data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function moedaBR(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function tempoRelativo(dias) {
  if (dias == null) return 'data desconhecida';
  if (dias < 31) return `${dias} dia(s)`;
  if (dias < 365) return `${Math.round(dias / 30)} mês(es)`;
  return `${Math.floor(dias / 365)} ano(s)`;
}
