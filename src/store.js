// src/store.js
// Persistência simples em arquivo JSON (data/db.json): sobrevive a reinícios do servidor.
// Usuários são guardados pelo HASH do telefone, nunca pelo número (LGPD).
// Quando crescer, trocar por Supabase/Postgres mantendo estas mesmas funções.
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const ARQ = path.join(DATA_DIR, 'db.json');

const vazio = () => ({ conversas: {}, casos: {}, contadorCaso: 100, denuncias: {}, consultas: {} });
let db = carregar();
let timer = null;

function carregar() {
  try {
    return { ...vazio(), ...JSON.parse(fs.readFileSync(ARQ, 'utf8')) };
  } catch {
    return vazio();
  }
}

export function gravarAgora() {
  clearTimeout(timer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conteudo = JSON.stringify(db);
    const tmp = `${ARQ}.tmp`;
    fs.writeFileSync(tmp, conteudo);
    try {
      fs.renameSync(tmp, ARQ);
    } catch {
      fs.writeFileSync(ARQ, conteudo); // Windows/OneDrive às vezes trava o rename
      fs.rmSync(tmp, { force: true });
    }
  } catch (err) {
    console.error('[store] falha ao salvar:', err.message);
  }
}

export function salvar() {
  clearTimeout(timer);
  timer = setTimeout(gravarAgora, 300);
  timer.unref?.();
}

process.on('exit', gravarAgora);
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => process.exit(0));

export const getDb = () => db;

export function getConversationState(uid) {
  if (!db.conversas[uid]) db.conversas[uid] = { estado: 'novo', criadoEm: new Date().toISOString() };
  return db.conversas[uid];
}

export function setConversationState(uid, patch) {
  db.conversas[uid] = { ...getConversationState(uid), ...patch, atualizadoEm: new Date().toISOString() };
  salvar();
}

export function abrirCaso(uid, tipo, dados = {}) {
  db.contadorCaso += 1;
  const id = `FR-${db.contadorCaso}`;
  db.casos[id] = { uid, tipo, criadoEm: new Date().toISOString(), ...dados };
  salvar();
  return id;
}

export const getCaso = (id) => db.casos[id];

export function atualizarCaso(id, patch) {
  if (!db.casos[id]) return;
  db.casos[id] = { ...db.casos[id], ...patch };
  salvar();
}
