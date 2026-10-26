// src/messageHandler.js
// Orquestrador: recebe cada mensagem do WhatsApp e decide o que fazer.
//
//   texto / print / encaminhada ──► extrai links, Pix, CNPJ, boleto, telefones
//                                  ├─ padrões de golpe no texto (regras)
//                                  ├─ link: 4 fontes + marca falsa + denúncias
//                                  ├─ CNPJ: BrasilAPI (Receita)
//                                  ├─ boleto: dígitos verificadores, banco, vencimento
//                                  └─ IA só EXPLICA o resultado
//   botões ──► menu, checkup de CPF, incidente (MED/B.O./dossiê), denúncia
import { classifyMessage, generateReply, lerImagem } from './llm.js';
import { sendText, sendButtons, downloadMedia } from './whatsappSend.js';
import { analisarUrl, normalizarUrl, getDomain } from './riskChecks.js';
import { dominioRegistravel } from './brandCheck.js';
import { analisarTexto, DICAS } from './patterns.js';
import { consultarCnpj } from './cnpj.js';
import { analisarBoleto } from './boleto.js';
import { extrairEntidades, mascararChave, extrairValor } from './entities.js';
import { registrarDenuncia, contarDenuncias, registrarConsulta } from './reports.js';
import * as incidente from './incident.js';
import * as checkup from './cpfCheckup.js';
import { getConversationState, setConversationState, getCaso, atualizarCaso } from './store.js';
import { registrarEvento } from './metrics.js';
import { hashId, normalizar } from './util.js';

const processados = new Set();
const ritmo = new Map();
const LIMITE_HORA = Number(process.env.RATE_LIMIT_PER_HOUR || 40);

const NIVEL = {
  alto: '🔴 *Alto risco de golpe*',
  medio: '🟠 *Atenção: tem sinais suspeitos*',
  baixo: '🟢 *Não encontrei sinais claros de golpe*',
};
const ORDEM = { baixo: 0, medio: 1, alto: 2 };
const maxNivel = (...ns) => ns.filter(Boolean).reduce((a, b) => (ORDEM[b] > ORDEM[a] ? b : a), 'baixo');

const MENU = `Oi! Eu sou o *Fraus* 🛡️, seu antifraude no WhatsApp.

Me manda qualquer coisa suspeita que eu analiso:
• uma *mensagem* encaminhada
• um *link*
• um *print* ou foto
• a *linha digitável* de um boleto
• uma *chave Pix* ou *CNPJ* antes de pagar

Também faço o *checkup do seu CPF* e te guio se você *já caiu* em um golpe.`;

const PEDIR_CONTEUDO = 'Me manda o que você recebeu 👇\nPode *encaminhar a mensagem*, colar o *link*, mandar um *print*, a *linha digitável* do boleto ou a *chave Pix*.';

const BOTOES_MENU = [
  { id: 'checar', title: '🔍 Checar algo' },
  { id: 'cpf', title: '🪪 Checkup do CPF' },
  { id: 'incidente', title: '🆘 Caí num golpe' },
];
const BOTOES_POS_ANALISE = [
  { id: 'denunciar', title: '🚩 Denunciar' },
  { id: 'incidente', title: '😰 Já paguei/cliquei' },
  { id: 'menu', title: '🏠 Menu' },
];

// ---------------------------------------------------------------- entrada

export async function handleIncomingMessage(msg) {
  if (!msg?.id || processados.has(msg.id)) return; // a Meta pode reenviar o mesmo evento
  processados.add(msg.id);
  if (processados.size > 5000) processados.clear();

  const from = msg.from;
  const uid = hashId(from);

  try {
    const limite = limiteDeUso(uid);
    if (limite === 'avisar') {
      await sendText(from, 'Você mandou muitas mensagens em pouco tempo 😅 Espera um pouquinho e tenta de novo. Se for urgente, ligue para o seu banco pelo número do verso do cartão.');
    }
    if (limite) return;

    const botao = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || msg.button?.payload;
    if (botao) return await tratarBotao(from, uid, botao);

    switch (msg.type) {
      case 'text':
        return await tratarTexto(from, uid, msg.text.body, {
          encaminhada: Boolean(msg.context?.forwarded || msg.context?.frequently_forwarded),
        });
      case 'image':
        return await tratarImagem(from, uid, msg.image);
      case 'document':
        return await sendText(from, 'Ainda não consigo abrir arquivos. Se for um boleto, me manda a *linha digitável* (os números) ou um *print* dele.');
      case 'audio':
        return await sendText(from, 'Ainda não consigo ouvir áudios 🙉 Se alguém te mandou um áudio pedindo dinheiro, me conta por escrito o que dizia.');
      case 'reaction':
      case 'sticker':
        return;
      default:
        return await sendText(from, 'Por enquanto eu entendo texto, links e prints. Me manda o que você recebeu.');
    }
  } catch (err) {
    console.error('[handler] erro:', err);
    try {
      await sendText(from, 'Tive um problema técnico agora 😕 Tenta de novo em um minuto. Se for urgente, ligue para o seu banco pelo número do verso do cartão.');
    } catch {
      /* se nem isso funcionou, provavelmente é o token do WhatsApp */
    }
  }
}

// Protege as cotas gratuitas: no máximo N mensagens por pessoa por hora.
function limiteDeUso(uid) {
  const agora = Date.now();
  const lista = (ritmo.get(uid) || []).filter((t) => agora - t < 3600000);
  lista.push(agora);
  ritmo.set(uid, lista);
  if (lista.length === LIMITE_HORA + 1) return 'avisar';
  return lista.length > LIMITE_HORA ? 'bloquear' : false;
}

// ---------------------------------------------------------------- texto

async function tratarTexto(from, uid, texto, opts = {}) {
  const t = normalizar(texto).trim();
  const estado = getConversationState(uid);
  registrarEvento(uid, 'mensagem', { origem: opts.origem || 'texto' });

  // Comandos curtos: respondem na hora, sem gastar IA.
  if (/^(menu|inicio|ajuda|oi+|ola|opa|bom dia|boa tarde|boa noite|e ai|hello|hi)[!.? ]*$/.test(t)) return enviarMenu(from, uid);
  if (/^(resumo|dossie|ver dossie)\b/.test(t)) return enviarDossie(from, uid);
  if (/^denunci/.test(t) && t.length < 20) return denunciar(from, uid);
  if (/^(ch[aei]c(ar|a|k)|checagem|verificar|analisar|conferir|consultar|quero (checar|verificar|analisar))[!.? ]*$/.test(t)) return sendText(from, PEDIR_CONTEUDO);
  if (/^(cpf|checkup|check-up|(verificar|consultar|checar) (o )?(meu )?cpf)[!.? ]*$/.test(t)) return iniciarCheckup(from, uid);

  // Esperando o relato do incidente
  if (estado.estado === 'aguardando_relato' && estado.caseId) return registrarRelato(from, uid, texto, estado);

  if (incidente.detectarIntencaoDeIncidente(texto)) return iniciarIncidente(from, uid);

  const entidades = extrairEntidades(texto);
  const padroes = analisarTexto(texto);
  const pergunta = /^(como|o que|oque|qual|quais|quando|onde|por ?que|pra que|para que|posso|devo|existe|tem como)\b/.test(t) && t.length < 120;
  if (entidades.total > 0 || opts.encaminhada || opts.origem === 'imagem' || (padroes.score >= 3 && !pergunta)) {
    return analisarConteudo(from, uid, texto, entidades, padroes, opts);
  }

  // Pergunta livre: a IA decide a intenção.
  const { intent } = await classifyMessage(texto);
  console.log(`[handler] intent=${intent}`);
  if (intent === 'saudacao') return enviarMenu(from, uid);
  if (intent === 'cpf') return iniciarCheckup(from, uid);
  if (intent === 'incidente') return iniciarIncidente(from, uid);
  if (intent === 'checar_link' || intent === 'checar_mensagem') {
    if (t.length > 60) return analisarConteudo(from, uid, texto, entidades, padroes, opts);
    return sendText(from, PEDIR_CONTEUDO);
  }
  let resposta;
  try {
    resposta = await generateReply(texto);
  } catch {
    resposta = 'Não entendi bem 🤔 ' + PEDIR_CONTEUDO;
  }
  return sendButtons(from, resposta + lembreteCheckup(uid), BOTOES_MENU);
}

// ---------------------------------------------------------------- imagem

async function tratarImagem(from, uid, imagem) {
  await sendText(from, 'Recebi a imagem, já estou analisando 🔍');
  let lido;
  try {
    const { buffer, mimeType } = await downloadMedia(imagem.id);
    if (buffer.length > 4.5 * 1024 * 1024) return sendText(from, 'Essa imagem é grande demais para mim 😅 Manda um print menor ou cole o texto aqui.');
    lido = await lerImagem(buffer.toString('base64'), mimeType);
  } catch (err) {
    console.warn('[imagem]', err.message);
    return sendText(from, 'Não consegui ler essa imagem agora 😕 Pode colar aqui o texto, o link ou os números do boleto?');
  }
  const texto = [imagem.caption, lido.texto].filter(Boolean).join('\n').trim();
  registrarEvento(uid, 'imagem', { tipoImagem: lido.tipo });
  if (!texto) return sendText(from, 'Não encontrei texto nessa imagem. Se for um boleto ou conversa, tente um print mais nítido.');
  return analisarConteudo(from, uid, texto, extrairEntidades(texto), analisarTexto(texto), { origem: 'imagem', tipoImagem: lido.tipo });
}

// ---------------------------------------------------------------- análise

async function analisarConteudo(from, uid, texto, ent, padroes, opts = {}) {
  const cnpjAlvo = ent.pix?.tipo === 'cnpj' ? ent.pix.chave : ent.cnpjs[0];
  const [links, empresa, boleto] = await Promise.all([
    Promise.all(ent.urls.map((u) => analisarUrl(normalizarUrl(u)).catch((e) => { console.warn('[link]', e.message); return null; }))),
    cnpjAlvo ? consultarCnpj(cnpjAlvo) : null,
    ent.linha ? analisarBoleto(ent.linha) : null,
  ]);

  let nivel = padroes.nivel;
  const achados = padroes.sinais.filter((s) => !(ent.urls.length && s === 'Tem link para clicar'));
  const paraDenuncia = [];
  const itens = [];

  for (const l of links.filter(Boolean)) {
    nivel = maxNivel(nivel, l.nivel);
    itens.push('link');
    paraDenuncia.push({ tipo: 'dominio', valor: l.dominioBase, exibir: l.dominio });
    achados.push(`🔗 *${l.dominio}* · score ${l.score}/100: ${l.motivos.length ? l.motivos.join('; ') : 'nenhuma base consultada sinalizou'}`);
  }
  if (empresa) {
    nivel = maxNivel(nivel, empresa.nivel);
    itens.push('cnpj');
    const info = [empresa.resumo, ...empresa.motivos].filter(Boolean).join(' · ') || 'não consegui consultar a Receita agora';
    achados.push(`🏢 CNPJ ${empresa.rotulo}: ${info}`);
    paraDenuncia.push({ tipo: 'cnpj', valor: empresa.cnpj, exibir: empresa.rotulo });
  }
  if (ent.pix) {
    itens.push('pix');
    const den = contarDenuncias('pix', ent.pix.chave);
    if (den) nivel = maxNivel(nivel, den >= 2 ? 'alto' : 'medio');
    achados.push(`🔑 Chave Pix (${ent.pix.tipo}) ${mascararChave(ent.pix)}${den ? `: 🚩 *denunciada por ${den} usuário(s) do Fraus*` : ': sem denúncias no Fraus'}`);
    if (ent.pix.tipo !== 'cnpj') achados.push('Antes de confirmar o Pix, o app do banco mostra o *nome do recebedor*: confira se é mesmo quem deveria receber');
    paraDenuncia.push({ tipo: 'pix', valor: ent.pix.chave, exibir: mascararChave(ent.pix) });
  }
  for (const tel of ent.telefones) {
    const den = contarDenuncias('telefone', tel);
    if (den) {
      nivel = maxNivel(nivel, den >= 2 ? 'alto' : 'medio');
      achados.push(`📞 O número (${tel.slice(0, 2)}) …${tel.slice(-4)} foi *denunciado por ${den} usuário(s)* do Fraus`);
    }
    paraDenuncia.push({ tipo: 'telefone', valor: tel, exibir: `(${tel.slice(0, 2)}) …${tel.slice(-4)}` });
  }
  if (boleto) {
    nivel = maxNivel(nivel, boleto.nivel);
    itens.push('boleto');
    achados.push(`🧾 Boleto ${boleto.resumo}${boleto.valido ? ' · código válido' : ''}`);
    achados.push(...boleto.motivos);
    if (boleto.tipo === 'bancario') achados.push('Na hora de pagar, confira se o *beneficiário* que aparece no app é exatamente quem te cobrou: o golpe mais comum troca só o beneficiário');
    paraDenuncia.push({ tipo: 'boleto', valor: ent.linha, exibir: 'esse boleto' });
  }
  if (!itens.length) itens.push('mensagem');

  const golpe = padroes.golpe;
  const cabecalho = [
    opts.origem === 'imagem' ? `📸 _Li a imagem (${opts.tipoImagem || 'print'})_` : null,
    NIVEL[nivel],
    golpe ? `_Parecido com: ${golpe}_` : null,
  ].filter(Boolean).join('\n');

  const contexto = `Resultado da análise:
- Nível de risco: ${nivel}${golpe ? `\n- Padrão de golpe reconhecido: ${golpe}` : ''}
- Achados: ${achados.length ? achados.join(' | ') : 'nenhum sinal encontrado'}
Escreva no máximo 3 frases curtas dizendo o que isso significa para a pessoa e qual a ação mais importante agora.
Não repita a lista de achados. Não invente fatos. Se o risco for alto, diga que tem cara de golpe (sem afirmar com certeza absoluta). Se o risco for baixo, não diga que é seguro: diga que não encontrou sinais claros e que vale confirmar por outro canal antes de pagar ou passar dados.`;
  let explicacao;
  try {
    explicacao = await generateReply(texto.slice(0, 1500), contexto, { maxTokens: 300 });
  } catch {
    explicacao = DICAS[golpe] || DICAS[nivel];
  }

  const corpo = [
    cabecalho,
    achados.length ? `*O que encontrei:*\n${achados.map((a) => `• ${a}`).join('\n')}` : null,
    explicacao,
  ].filter(Boolean).join('\n\n');

  setConversationState(uid, {
    estado: 'analisou',
    ultimaAnalise: { quando: new Date().toISOString(), nivel, golpe, achados: achados.slice(0, 8), entidades: paraDenuncia },
  });
  paraDenuncia.forEach((e) => registrarConsulta(e.tipo, e.valor));
  registrarEvento(uid, 'analise', { nivel, golpe, itens, origem: opts.origem || 'texto' });

  return sendButtons(from, corpo + lembreteCheckup(uid), BOTOES_POS_ANALISE);
}

// ---------------------------------------------------------------- botões

async function tratarBotao(from, uid, id) {
  registrarEvento(uid, 'botao', { id });
  switch (id) {
    case 'menu': return enviarMenu(from, uid);
    case 'checar': return sendText(from, PEDIR_CONTEUDO);
    case 'cpf': return iniciarCheckup(from, uid);
    case 'cpf_ok':
      setConversationState(uid, { estado: 'novo', ultimoCheckupCpf: new Date().toISOString() });
      registrarEvento(uid, 'checkup_cpf', { resultado: 'ok' });
      return sendButtons(from, checkup.TEXTO_OK, [{ id: 'menu', title: '🏠 Menu' }]);
    case 'cpf_estranho':
      setConversationState(uid, { ultimoCheckupCpf: new Date().toISOString() });
      registrarEvento(uid, 'checkup_cpf', { resultado: 'estranho' });
      return abrirIncidente(from, uid, 'identidade');
    case 'cpf_depois': return sendText(from, checkup.TEXTO_DEPOIS);
    case 'incidente': return iniciarIncidente(from, uid);
    case 'novo_caso': return sendButtons(from, 'O que aconteceu dessa vez?', incidente.BOTOES_TIPO);
    case 'inc_pix': case 'inc_senha': case 'inc_dados': return abrirIncidente(from, uid, id.slice(4));
    case 'denunciar': return denunciar(from, uid);
    case 'dossie': return enviarDossie(from, uid);
    default: return enviarMenu(from, uid);
  }
}

function enviarMenu(from, uid) {
  const estado = getConversationState(uid);
  // "menu" também serve para sair do modo relato sem perder o caso
  setConversationState(uid, { estado: estado.caseId ? 'incidente' : 'novo' });
  return sendButtons(from, MENU + lembreteCheckup(uid), BOTOES_MENU);
}

function iniciarCheckup(from, uid) {
  setConversationState(uid, { estado: 'checkup_cpf', lembreteCheckupEm: new Date().toISOString() });
  return sendButtons(from, checkup.TEXTO, checkup.BOTOES);
}

function lembreteCheckup(uid) {
  const estado = getConversationState(uid);
  const texto = checkup.lembrete(estado);
  if (!texto) return '';
  setConversationState(uid, { lembreteCheckupEm: new Date().toISOString() });
  return texto;
}

// ---------------------------------------------------------------- incidente

function iniciarIncidente(from, uid) {
  const estado = getConversationState(uid);
  const caso = estado.caseId && getCaso(estado.caseId);
  const recente = caso && Date.now() - Date.parse(caso.criadoEm) < 48 * 3600000;
  if (recente) {
    return sendButtons(from, `Você tem o *caso #${estado.caseId}* aberto. Quer ver o dossiê dele ou abrir um caso novo?`, [
      { id: 'dossie', title: '📁 Ver dossiê' },
      { id: 'novo_caso', title: '🆕 Abrir caso novo' },
      { id: 'menu', title: '🏠 Menu' },
    ]);
  }
  return sendButtons(from, 'Calma, dá para agir 🤝 Primeiro me diz: o que aconteceu?', incidente.BOTOES_TIPO);
}

function abrirIncidente(from, uid, tipo) {
  const estado = getConversationState(uid);
  const ua = estado.ultimaAnalise;
  const contexto = ua && Date.now() - Date.parse(ua.quando) < 30 * 60000 ? { nivel: ua.nivel, golpe: ua.golpe, achados: ua.achados } : null;
  const caseId = incidente.abrirCasoIncidente(uid, tipo, contexto);
  setConversationState(uid, { estado: 'aguardando_relato', caseId });
  registrarEvento(uid, 'caso', { casoTipo: tipo });
  return sendText(from, incidente.textoChecklist(tipo, caseId));
}

async function registrarRelato(from, uid, texto, estado) {
  const ent = extrairEntidades(texto);
  const ua = estado.ultimaAnalise;
  const dados = {
    relato: texto,
    valor: extrairValor(texto),
    pix: ent.pix ? `${ent.pix.chave} (${ent.pix.tipo})` : null,
    links: ent.urls,
    telefones: ent.telefones,
  };
  atualizarCaso(estado.caseId, dados);

  // Golpe confirmado pela vítima = denúncia mais forte que existe: protege os próximos.
  let denunciados = 0;
  if (ent.pix && registrarDenuncia('pix', ent.pix.chave, uid)) denunciados++;
  for (const u of ent.urls) {
    const host = getDomain(normalizarUrl(u));
    if (host && registrarDenuncia('dominio', dominioRegistravel(host), uid)) denunciados++;
  }
  for (const t of ent.telefones) if (registrarDenuncia('telefone', t, uid)) denunciados++;
  if (ua?.entidades?.length && Date.now() - Date.parse(ua.quando) < 30 * 60000) {
    for (const e of ua.entidades) if (e.tipo !== 'cnpj' && registrarDenuncia(e.tipo, e.valor, uid)) denunciados++;
  }
  if (denunciados) registrarEvento(uid, 'denuncia', { origem: 'incidente', quantidade: denunciados });

  setConversationState(uid, { estado: 'incidente' });
  const extra = denunciados ? `\n\n🚩 Também registrei ${denunciados} item(ns) do golpista na base do Fraus: quem receber a mesma coisa vai ser avisado.` : '';
  return sendButtons(from, `Anotei tudo no *caso #${estado.caseId}* ✅${extra}\n\nToque em *Ver dossiê* para receber o resumo pronto para mandar ao banco e anexar no B.O.`, [
    { id: 'dossie', title: '📁 Ver dossiê' },
    { id: 'menu', title: '🏠 Menu' },
  ]);
}

function enviarDossie(from, uid) {
  const estado = getConversationState(uid);
  const caso = estado.caseId && getCaso(estado.caseId);
  if (!caso) return sendButtons(from, 'Você não tem nenhum caso aberto. Se caiu em um golpe, toque abaixo que eu te ajudo.', [{ id: 'incidente', title: '🆘 Caí num golpe' }]);
  if (estado.estado === 'aguardando_relato') setConversationState(uid, { estado: 'incidente' });
  return sendText(from, incidente.gerarDossie(caso, estado.caseId));
}

// ---------------------------------------------------------------- denúncia

function denunciar(from, uid) {
  const ua = getConversationState(uid).ultimaAnalise;
  const itens = ua?.entidades?.filter((e) => e.tipo !== 'cnpj') || [];
  if (!itens.length) {
    return sendText(from, 'Para denunciar, primeiro me manda o *link, número, chave Pix ou boleto* suspeito para eu analisar. Depois é só tocar em 🚩 Denunciar.');
  }
  let novos = 0;
  const linhas = itens.map((e) => {
    if (registrarDenuncia(e.tipo, e.valor, uid)) novos++;
    return `• ${e.exibir}: ${contarDenuncias(e.tipo, e.valor)} denúncia(s) no Fraus`;
  });
  if (novos) registrarEvento(uid, 'denuncia', { origem: 'botao', quantidade: novos });
  const dicas = [];
  if (itens.some((e) => e.tipo === 'dominio')) dicas.push('Você também pode denunciar o site ao Google em safebrowsing.google.com/safebrowsing/report_phish');
  if (itens.some((e) => e.tipo === 'telefone')) dicas.push('No WhatsApp, abra a conversa do golpista e use *Denunciar* e *Bloquear*');
  return sendText(from, `${novos ? '🚩 *Denúncia registrada, obrigado!*' : 'Você já tinha denunciado isso 👍'}
A partir de agora, quem consultar isso no Fraus recebe o alerta.

${linhas.join('\n')}${dicas.length ? `\n\n${dicas.join('\n')}` : ''}`);
}