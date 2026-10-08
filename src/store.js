// Armazenamento em memoria - suficiente para o MVP.
// Quando o volume crescer, trocar por um banco real (ex: Supabase/Postgres),
// mantendo a mesma interface (get/set) para nao precisar reescrever o resto do codigo.

const conversations = new Map(); // telefone -> { estado, ultimaUrlAnalisada, ... }
const casos = new Map(); // caseId -> { telefone, tipo, criadoEm, dados }

let contadorCaso = 100;

export function getConversationState(telefone) {
  if (!conversations.has(telefone)) {
    conversations.set(telefone, { estado: 'novo' });
  }
  return conversations.get(telefone);
}

export function setConversationState(telefone, patch) {
  const atual = getConversationState(telefone);
  conversations.set(telefone, { ...atual, ...patch });
}

export function abrirCaso(telefone, tipo, dados) {
  contadorCaso += 1;
  const caseId = `GD-${contadorCaso}`;
  casos.set(caseId, { telefone, tipo, criadoEm: new Date().toISOString(), dados });
  return caseId;
}

export function getCaso(caseId) {
  return casos.get(caseId);
}