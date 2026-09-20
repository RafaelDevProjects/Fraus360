import axios from 'axios';

// Traduz o resultado tecnico da analise (score + motivos) numa mensagem curta,
// em linguagem simples, no tom do Guardiao - isso e a camada de propriedade
// intelectual do produto: o valor nao esta so no dado bruto, esta em como ele
// e explicado e em qual acao ele recomenda.
export async function explicarScore({ url, score, nivel, motivos }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Fallback sem LLM: garante que o produto funciona mesmo sem a chave configurada ainda.
  if (!apiKey) return explicacaoPadrao({ score, nivel, motivos });

  const prompt = `Você é o Guardião, um assistente de segurança digital que responde no WhatsApp.
Um usuário te enviou este link: ${url}
Nossa análise técnica encontrou:
- Score de risco: ${score}/100 (nível: ${nivel})
- Motivos identificados: ${motivos.length ? motivos.join('; ') : 'nenhum sinal de risco encontrado'}

Escreva uma resposta curta (máximo 4 linhas), em português informal e direto, explicando o risco
para uma pessoa sem conhecimento técnico e dizendo claramente o que fazer. Não invente motivos
além dos listados. Não use jargão técnico.`;

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );
    const texto = data?.content?.find((b) => b.type === 'text')?.text;
    return texto || explicacaoPadrao({ score, nivel, motivos });
  } catch (err) {
    console.error('Chamada ao LLM falhou:', err.response?.data || err.message);
    return explicacaoPadrao({ score, nivel, motivos });
  }
}

// Explicação sem LLM, usada como fallback caso a chamada falhe ou a chave não esteja configurada.
function explicacaoPadrao({ score, nivel, motivos }) {
  const cabecalho =
    nivel === 'alto'
      ? '⚠️ *Risco alto* - recomendo não clicar nem preencher nada.'
      : nivel === 'medio'
      ? '🟡 *Risco médio* - tenha cautela antes de continuar.'
      : '✅ *Risco baixo* - não encontramos sinais claros de golpe.';

  const lista = motivos.length
    ? motivos.map((m) => `• ${m}`).join('\n')
    : '• Nenhum sinal de risco encontrado nas fontes consultadas';

  return `${cabecalho}\n\nScore: ${score}/100\n\n${lista}`;
}
