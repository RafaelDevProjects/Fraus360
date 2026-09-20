# Guardião — MVP

Esqueleto funcional do agente Guardião (VID) no WhatsApp: recebe mensagens, analisa
links suspeitos com fontes gratuitas, explica o risco em linguagem simples via LLM,
e conduz um fluxo guiado quando o usuário relata um incidente.

## O que você precisa ter/criar antes de rodar

### Contas e chaves (todas com camada gratuita)
| Serviço | Para quê | Onde conseguir |
|---|---|---|
| Meta for Developers (WhatsApp Cloud API) | Enviar/receber mensagens | Já aprovado |
| Google Cloud Console | Chave da Safe Browsing API | console.cloud.google.com → ativar "Safe Browsing API" → criar credencial |
| VirusTotal | Chave gratuita (500 consultas/dia) | virustotal.com → criar conta → API key no perfil |
| PhishTank | App key opcional (aumenta o limite) | phishtank.org → registrar |
| Anthropic (ou outro provedor de LLM) | Explicar o score em linguagem simples | console.anthropic.com → gerar API key |

RDAP (idade de domínio) não precisa de chave — é um protocolo público.

### Ferramentas de infraestrutura
- **Node.js 18+** instalado localmente.
- **ngrok** (ou similar) para expor seu servidor local com HTTPS durante o desenvolvimento — o webhook da Meta exige HTTPS público.
- Uma conta em um serviço de hospedagem para quando sair do teste local: **Render** ou **Railway** têm tier gratuito suficiente para essa fase.
- Editor de código (VS Code) e Git/GitHub para versionar.
- **Postman** ou **Insomnia** (opcional, mas ajuda a simular payloads de webhook manualmente enquanto testa).

## Passo a passo

1. **Instalar dependências**
   ```bash
   npm install
   ```

2. **Configurar variáveis de ambiente**
   ```bash
   cp .env.example .env
   ```
   Preencha o `.env` com as chaves da tabela acima. `WHATSAPP_VERIFY_TOKEN` é qualquer
   string que você escolhe — vai usar o mesmo valor no painel da Meta.

3. **Rodar localmente**
   ```bash
   npm run dev
   ```

4. **Expor com ngrok e configurar o webhook**
   ```bash
   ngrok http 3000
   ```
   Copie a URL HTTPS gerada (ex: `https://abcd1234.ngrok.app`) e configure no painel
   da Meta for Developers: **URL de callback** = `https://abcd1234.ngrok.app/webhook`,
   **Verify token** = o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN`.
   Assine o campo `messages`.

5. **Testar**
   Mande uma mensagem para o número de teste do WhatsApp Business. Deve chegar a
   mensagem de boas-vindas. Mande um link para ver a análise de risco completa.

6. **Deploy**
   Quando o fluxo estiver validado localmente, suba o mesmo projeto no Render/Railway,
   aponte as mesmas variáveis de ambiente por lá, e troque a URL do webhook na Meta
   pela URL final de produção (sem depender mais do ngrok).

## O que este esqueleto NÃO cobre ainda (próximos passos técnicos)
- Persistência real (hoje o estado da conversa é em memória e se perde a cada reinício do servidor) — trocar `src/store.js` por um banco como Supabase quando fizer sentido.
- Verificação da assinatura `X-Hub-Signature-256` do webhook (segurança contra chamadas falsas ao endpoint) — importante antes de qualquer demo pública.
- O Pilar 2 (checagem de CNPJ/sócios via BrasilAPI) ainda não está integrado neste esqueleto — é o próximo módulo a somar, seguindo o mesmo padrão de `riskChecks.js`.
- Classificação de intenção via LLM (hoje a detecção de incidente é por palavra-chave simples).
