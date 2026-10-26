# Fraus — MVP

Agente antifraude no WhatsApp. A pessoa encaminha o que recebeu e o Fraus responde em segundos se tem cara de golpe, por quê, e o que fazer. Tudo roda com serviços **gratuitos**.

## O que ele faz

| Funcionalidade | Como funciona | Custo |
|---|---|---|
| **Mensagem suspeita** | Regras reconhecem 6 golpes (falso parente, falsa central, falso prêmio, falsa entrega, renda fácil, falsa cobrança) | Grátis (local) |
| **Link** | Google Safe Browsing + VirusTotal + idade do domínio (RDAP) + PhishTank + detector de marca falsa (`banc0-itau.com`, `gov-br-regulariza.online`) + abre encurtadores para ver o destino | Grátis |
| **Print / foto** | IA com visão transcreve a imagem e o resto da análise roda em cima | Grátis (OpenRouter) |
| **Boleto** | Valida os dígitos verificadores da linha digitável (pega código adulterado), mostra banco, valor e vencimento | Grátis (local) |
| **CNPJ / chave Pix** | Consulta a Receita via BrasilAPI: existe? está ativa? foi aberta há quanto tempo? | Grátis |
| **Denúncias da comunidade** | Cada link, chave Pix, telefone ou boleto denunciado alerta os próximos usuários | Grátis (local) |
| **Caí num golpe** | Checklist por tipo (Pix → MED, senha/código, dados), coleta o relato e gera um **dossiê** para o banco e o B.O. | Grátis |
| **Checkup do CPF** | Guia a consulta no Registrato (Banco Central) e Serasa, sem pedir o CPF; lembra a cada 30 dias | Grátis |
| **Métricas para o pitch** | `/stats?token=...` mostra usuários, análises, golpes pegos, casos e denúncias | Grátis |

A IA **não decide** o risco: regras e fontes verificáveis decidem, a IA só explica. Se a IA cair, o bot continua funcionando com textos prontos.

**Privacidade:** o telefone é guardado só como hash, o Fraus nunca pede o CPF, e CPF e cartão são mascarados antes de ir para a IA.

## Rodar

```bash
npm install
cp .env.example .env      # preencha (cada variável numa linha!)
npm test                  # testes das regras
npm run simular           # conversa no terminal, sem WhatsApp
npm run dev               # servidor de verdade
```

No simulador, use `/fwd texto` (encaminhada), `/b id` (botão), `/img caminho` (print) e `/sair`.

Para o WhatsApp: rode `npm run dev`, abra o Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) e cadastre `https://SUA-URL/webhook` no painel da Meta com o mesmo `WHATSAPP_VERIFY_TOKEN`.

## Estrutura

```
server.js            webhook, assinatura da Meta, /stats
sim.js               simulador no terminal
src/messageHandler   orquestrador (decide o que fazer com cada mensagem)
src/patterns         padrões de golpe no texto
src/riskChecks       análise de link (4 fontes + marca falsa + denúncias)
src/brandCheck       detector de domínio falso
src/boleto           validação de linha digitável
src/cnpj             consulta de CNPJ (BrasilAPI)
src/entities         extrai links, Pix, CNPJ, telefones, boleto
src/incident         checklist, MED, dossiê
src/cpfCheckup       checkup guiado do CPF
src/reports          base de denúncias
src/metrics          eventos para o pitch
src/store            persistência em data/db.json
src/llm              OpenRouter (texto e imagem)
src/whatsappSend     envio de texto, botões e download de prints
```

## Limites conhecidos (honestos)

- **CPF:** não há monitoramento automático (exige birô pago). O checkup é guiado e manual.
- **Boleto:** os dígitos provam que o código não foi alterado, mas não mostram o beneficiário: isso só aparece no app do banco na hora de pagar.
- **Denúncias:** um usuário mal-intencionado poderia denunciar algo legítimo. Hoje elas só geram alerta, nunca bloqueio.
- **Armazenamento em arquivo:** bom para dezenas ou centenas de usuários. Acima disso, migrar `store.js` para Supabase/Postgres.
- **Mensagens proativas** (o Fraus escrever primeiro) exigem templates aprovados pela Meta; por isso o lembrete do CPF aparece quando a pessoa fala com o bot.
