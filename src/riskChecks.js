// src/riskChecks.js
// Análise de LINK: 4 fontes externas gratuitas + análise local do endereço + denúncias do Fraus.
// Tudo vira um Trust Score de 0 (sem sinais) a 100 (risco máximo).
// Os pesos são uma primeira versão: devem ser ajustados com casos reais.
import axios from 'axios';
import { analisarDominio, ehEncurtador, dominioRegistravel } from './brandCheck.js';
import { contarDenuncias } from './reports.js';

const http = axios.create({ timeout: 8000 }); // sem timeout, uma fonte lenta trava tudo

export function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const normalizarUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

// Abre SÓ o encurtador (sem visitar o destino) para descobrir para onde ele leva.
async function expandirEncurtador(url) {
  let atual = url;
  for (let i = 0; i < 4 && ehEncurtador(getDomain(atual)); i++) {
    try {
      const res = await fetch(atual, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const destino = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !destino) break;
      atual = new URL(destino, atual).toString();
    } catch {
      break;
    }
  }
  return atual;
}

async function checkSafeBrowsing(url) {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return { fonte: 'safe_browsing', disponivel: false };
  try {
    const { data } = await http.post(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
      client: { clientId: 'fraus', clientVersion: '0.2' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    });
    return { fonte: 'safe_browsing', disponivel: true, sinalizado: Array.isArray(data.matches) && data.matches.length > 0 };
  } catch (err) {
    console.warn('[SafeBrowsing]', err.message);
    return { fonte: 'safe_browsing', disponivel: false };
  }
}

async function checkVirusTotal(url) {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return { fonte: 'virustotal', disponivel: false };
  const urlId = Buffer.from(url).toString('base64url').replace(/=+$/, '');
  const headers = { 'x-apikey': key };
  try {
    const { data } = await http.get(`https://www.virustotal.com/api/v3/urls/${urlId}`, { headers });
    const stats = data?.data?.attributes?.last_analysis_stats;
    if (!stats) return { fonte: 'virustotal', disponivel: true, status: 'sem_dados' };
    return { fonte: 'virustotal', disponivel: true, motoresMaliciosos: (stats.malicious || 0) + (stats.suspicious || 0) };
  } catch (err) {
    if (err.response?.status === 404) {
      http.post('https://www.virustotal.com/api/v3/urls', new URLSearchParams({ url }), { headers }).catch(() => {});
      return { fonte: 'virustotal', disponivel: true, status: 'pendente_primeira_analise' };
    }
    console.warn('[VirusTotal]', err.message); // 429 = limite de 4/min do plano grátis
    return { fonte: 'virustotal', disponivel: false };
  }
}

async function checkDomainAge(dominio) {
  if (!dominio || /^\d+(\.\d+){3}$/.test(dominio)) return { fonte: 'rdap', disponivel: false };
  try {
    const { data } = await http.get(`https://rdap.org/domain/${dominioRegistravel(dominio)}`, { validateStatus: (s) => s < 500 });
    const registro = data?.events?.find((e) => e.eventAction === 'registration');
    if (!registro) return { fonte: 'rdap', disponivel: true, idadeDias: null };
    return { fonte: 'rdap', disponivel: true, idadeDias: Math.floor((Date.now() - new Date(registro.eventDate)) / 86400000) };
  } catch (err) {
    console.warn('[RDAP]', err.message);
    return { fonte: 'rdap', disponivel: false };
  }
}

async function checkPhishTank(url) {
  try {
    const params = new URLSearchParams({ url, format: 'json' });
    if (process.env.PHISHTANK_APP_KEY && !process.env.PHISHTANK_APP_KEY.startsWith('opcional')) {
      params.append('app_key', process.env.PHISHTANK_APP_KEY);
    }
    const { data } = await http.post('https://checkurl.phishtank.com/checkurl/', params, { headers: { 'User-Agent': 'phishtank/fraus' } });
    const r = data?.results;
    return { fonte: 'phishtank', disponivel: Boolean(r), sinalizado: Boolean(r?.in_database && r?.valid) };
  } catch (err) {
    console.warn('[PhishTank]', err.message);
    return { fonte: 'phishtank', disponivel: false };
  }
}

export async function analisarUrl(urlRecebida) {
  const original = normalizarUrl(urlRecebida);
  const url = ehEncurtador(getDomain(original)) ? await expandirEncurtador(original) : original;
  const expandido = url !== original;
  const dominio = getDomain(url);

  const [safeBrowsing, virusTotal, rdap, phishTank] = await Promise.all([
    checkSafeBrowsing(url), checkVirusTotal(url), checkDomainAge(dominio), checkPhishTank(url),
  ]);

  let score = 5; // todo link começa com um risco mínimo
  const motivos = [];

  if (expandido) motivos.push(`Link encurtado que leva para *${dominio}*`);
  const local = analisarDominio(dominio);
  score += local.pontos;
  motivos.push(...local.motivos);

  if (safeBrowsing.sinalizado) {
    score += 45;
    motivos.push('Já catalogado pelo Google Safe Browsing como golpe ou vírus');
  }
  if (phishTank.sinalizado) {
    score += 35;
    motivos.push('Confirmado como phishing pela comunidade PhishTank');
  }
  if (virusTotal.motoresMaliciosos > 0) {
    score += Math.min(30, virusTotal.motoresMaliciosos * 5);
    motivos.push(`${virusTotal.motoresMaliciosos} antivírus marcaram como perigoso (VirusTotal)`);
  }
  if (typeof rdap.idadeDias === 'number') {
    if (rdap.idadeDias <= 7) {
      score += 30;
      motivos.push(`Site criado há apenas ${rdap.idadeDias} dia(s)`);
    } else if (rdap.idadeDias <= 30) {
      score += 15;
      motivos.push(`Site criado há ${rdap.idadeDias} dias (muito recente)`);
    }
  }
  const denuncias = contarDenuncias('dominio', dominioRegistravel(dominio || ''));
  if (denuncias > 0) {
    score += Math.min(40, 15 + denuncias * 5);
    motivos.push(`🚩 Denunciado por ${denuncias} usuário(s) do Fraus`);
  }

  score = Math.min(100, score);
  const nivel = score >= 60 ? 'alto' : score >= 30 ? 'medio' : 'baixo';
  const fontesOk = [safeBrowsing, virusTotal, rdap, phishTank].filter((f) => f.disponivel).length;

  return { url: original, urlFinal: url, dominio, dominioBase: dominioRegistravel(dominio || ''), score, nivel, motivos, denuncias,
    fontesOk, detalhes: { safeBrowsing, virusTotal, rdap, phishTank } };
}
