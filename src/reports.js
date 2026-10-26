// src/reports.js
// Base própria de denúncias: cada link, telefone, chave Pix ou boleto denunciado por um
// usuário passa a alertar todos os outros. Um usuário conta só uma vez por item.
// Os itens são guardados como hash (não guardamos a chave Pix ou o telefone em texto).
import { getDb, salvar } from './store.js';
import { hashId, normalizar } from './util.js';

const chave = (tipo, valor) => `${tipo}:${hashId(normalizar(String(valor)).trim())}`;

export function registrarDenuncia(tipo, valor, uid) {
  const db = getDb();
  const k = chave(tipo, valor);
  const r = db.denuncias[k] || (db.denuncias[k] = { usuarios: [], primeira: new Date().toISOString() });
  if (r.usuarios.includes(uid)) return false;
  r.usuarios.push(uid);
  r.ultima = new Date().toISOString();
  salvar();
  return true;
}

export const contarDenuncias = (tipo, valor) => getDb().denuncias[chave(tipo, valor)]?.usuarios.length || 0;

export function registrarConsulta(tipo, valor) {
  const db = getDb();
  const k = chave(tipo, valor);
  db.consultas[k] = (db.consultas[k] || 0) + 1;
  salvar();
}
