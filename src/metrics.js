// src/metrics.js
// Registro de uso para o pitch: quantas pessoas usaram, quantos golpes foram pegos etc.
// Eventos vão para data/events.jsonl (uma linha por evento, usuário anonimizado).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const ARQ = path.join(DATA_DIR, 'events.jsonl');

export function registrarEvento(uid, tipo, dados = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(ARQ, `${JSON.stringify({ ts: new Date().toISOString(), uid, tipo, ...dados })}\n`);
  } catch (err) {
    console.warn('[metrics]', err.message);
  }
}

export function resumo() {
  let eventos = [];
  try {
    eventos = fs.readFileSync(ARQ, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    /* ainda sem eventos */
  }
  const conta = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };
  const porTipo = {}, porNivel = {}, golpes = {}, casos = {}, conteudo = {};
  for (const e of eventos) {
    conta(porTipo, e.tipo);
    if (e.tipo === 'analise') {
      conta(porNivel, e.nivel);
      if (e.golpe) conta(golpes, e.golpe);
      (e.itens || []).forEach((i) => conta(conteudo, i));
    }
    if (e.tipo === 'caso') conta(casos, e.casoTipo);
  }
  return {
    geradoEm: new Date().toISOString(),
    periodo: { inicio: eventos[0]?.ts || null, fim: eventos.at(-1)?.ts || null },
    usuariosUnicos: new Set(eventos.map((e) => e.uid)).size,
    mensagens: porTipo.mensagem || 0,
    analises: porTipo.analise || 0,
    analisesPorNivel: porNivel,
    oQueFoiAnalisado: conteudo,
    golpesIdentificados: golpes,
    casosAbertos: casos,
    denuncias: porTipo.denuncia || 0,
    checkupsCpf: porTipo.checkup_cpf || 0,
    imagensLidas: porTipo.imagem || 0,
  };
}
