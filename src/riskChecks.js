import axios from 'axios';

// Extrai a primeira URL de um texto, ou null se nao houver nenhuma.
export function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// --- Fonte 1: Google Safe Browsing (gratuita) ---
// Verifica se a URL ja esta numa lista conhecida de phishing/malware.
async function checkSafeBrowsing(url) {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return { fonte: 'safe_browsing', disponivel: false };

  try {
    const { data } = await axios.post(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      {
        client: { clientId: 'guardiao-vid', clientVersion: '0.1' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }
    );
    const encontrado = Array.isArray(data.matches) && data.matches.length > 0;
    return { fonte: 'safe_browsing', disponivel: true, sinalizado: encontrado };
  } catch (err) {
    console.error('Safe Browsing falhou:', err.message);
    return { fonte: 'safe_browsing', disponivel: false };
  }
}

// --- Fonte 2: VirusTotal (gratuita, 4 req/min / 500 req/dia no tier publico) ---
// Consulta se a URL ja foi analisada; se nao, envia para analise (assincrona).
async function checkVirusTotal(url) {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return { fonte: 'virustotal', disponivel: false };

  const urlId = Buffer.from(url).toString('base64url').replace(/=+$/, '');
  const headers = { 'x-apikey': key };

  try {
    const { data } = await axios.get(`https://www.virustotal.com/api/v3/urls/${urlId}`, { headers });
    const stats = data?.data?.attributes?.last_analysis_stats;
    if (!stats) return { fonte: 'virustotal', disponivel: true, status: 'sem_dados' };
    const maliciosos = (stats.malicious || 0) + (stats.suspicious || 0);
    return { fonte: 'virustotal', disponivel: true, motoresMaliciosos: maliciosos };
  } catch (err) {
    if (err.response?.status === 404) {
      // Nunca analisado antes: envia para analise e informa que o resultado ainda nao esta pronto.
      try {
        await axios.post(
          'https://www.virustotal.com/api/v3/urls',
          new URLSearchParams({ url }),
          { headers }
        );
      } catch (submitErr) {
        console.error('Envio ao VirusTotal falhou:', submitErr.message);
      }
      return { fonte: 'virustotal', disponivel: true, status: 'pendente_primeira_analise' };
    }
    console.error('VirusTotal falhou:', err.message);
    return { fonte: 'virustotal', disponivel: false };
  }
}

// --- Fonte 3: idade do dominio via RDAP (protocolo gratuito, sucessor do WHOIS) ---
async function checkDomainAge(url) {
  const domain = getDomain(url);
  if (!domain) return { fonte: 'rdap', disponivel: false };

  try {
    const { data } = await axios.get(`https://rdap.org/domain/${domain}`, {
      validateStatus: (s) => s < 500,
    });
    const eventoRegistro = data?.events?.find((e) => e.eventAction === 'registration');
    if (!eventoRegistro) return { fonte: 'rdap', disponivel: true, idadeDias: null };

    const idadeDias = Math.floor(
      (Date.now() - new Date(eventoRegistro.eventDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return { fonte: 'rdap', disponivel: true, idadeDias };
  } catch (err) {
    console.error('RDAP falhou:', err.message);
    return { fonte: 'rdap', disponivel: false };
  }
}

// --- Fonte 4: PhishTank (banco de dados comunitario gratuito de phishing) ---
async function checkPhishTank(url) {
  try {
    const params = new URLSearchParams({ url, format: 'json' });
    if (process.env.PHISHTANK_APP_KEY) params.append('app_key', process.env.PHISHTANK_APP_KEY);

    const { data } = await axios.post('https://checkurl.phishtank.com/checkurl/', params, {
      headers: { 'User-Agent': 'guardiao-vid/0.1' },
    });
    const resultado = data?.results;
    return {
      fonte: 'phishtank',
      disponivel: true,
      sinalizado: Boolean(resultado?.in_database && resultado?.valid),
    };
  } catch (err) {
    console.error('PhishTank falhou:', err.message);
    return { fonte: 'phishtank', disponivel: false };
  }
}

// Roda todas as checagens em paralelo e agrega num Trust Score de 0 (seguro) a 100 (risco maximo).
// A logica de pontuacao aqui e uma primeira versao (heuristica simples) - o ajuste fino dos pesos
// deve vir das entrevistas e de casos reais observados, nao e um numero definitivo.
export async function analisarUrl(url) {
  const [safeBrowsing, virusTotal, rdap, phishTank] = await Promise.all([
    checkSafeBrowsing(url),
    checkVirusTotal(url),
    checkDomainAge(url),
    checkPhishTank(url),
  ]);

  let score = 5; // baseline: todo link comeca com um risco minimo
  const motivos = [];

  if (safeBrowsing.disponivel && safeBrowsing.sinalizado) {
    score += 45;
    motivos.push('Já catalogado pelo Google Safe Browsing como phishing/malware');
  }
  if (phishTank.disponivel && phishTank.sinalizado) {
    score += 35;
    motivos.push('Denunciado e confirmado pela comunidade PhishTank');
  }
  if (virusTotal.disponivel && typeof virusTotal.motoresMaliciosos === 'number') {
    if (virusTotal.motoresMaliciosos > 0) {
      score += Math.min(30, virusTotal.motoresMaliciosos * 5);
      motivos.push(`${virusTotal.motoresMaliciosos} motor(es) de antivírus marcaram como malicioso no VirusTotal`);
    }
  }
  if (rdap.disponivel && typeof rdap.idadeDias === 'number') {
    if (rdap.idadeDias <= 7) {
      score += 30;
      motivos.push(`Domínio registrado há apenas ${rdap.idadeDias} dia(s)`);
    } else if (rdap.idadeDias <= 30) {
      score += 15;
      motivos.push(`Domínio registrado há ${rdap.idadeDias} dias (recente)`);
    }
  }

  score = Math.min(100, score);
  const nivel = score >= 60 ? 'alto' : score >= 30 ? 'medio' : 'baixo';

  return {
    url,
    score,
    nivel,
    motivos,
    detalhes: { safeBrowsing, virusTotal, rdap, phishTank },
  };
}
