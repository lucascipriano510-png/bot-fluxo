# bot-fluxo

Bot de WhatsApp da Fluxo Outlet.
API independente hospedada na Vercel. Banco Supabase (mesmo projeto do site, tabelas separadas).

## O que o bot faz com IA ligada (modo agente)

A IA (Gemini function calling) age como vendedor com ferramentas reais:

| Ferramenta | O que faz |
|---|---|
| `buscar_produtos` | Consulta o catálogo real (preço, cor, tamanho, estoque) |
| `enviar_fotos_produtos` | Manda a FOTO da peça no WhatsApp com preço na legenda (via wsrv.nl) |
| `montar_link_sacola` | Gera link do site com a sacola pronta (`?sacola=SKU:TAM:QTD`) — cliente só finaliza |
| `consultar_pedidos_cliente` | Pedidos anteriores do cliente no site |
| `salvar_dados_cliente` | Grava nome/tamanho/cidade/interesse no CRM durante a conversa |
| `chamar_atendente` | Handoff: marca lead QUENTE e avisa o operador no WhatsApp |

Além disso: transcreve **áudio**, entende **foto** enviada pelo cliente (visão),
mantém **memória de longo prazo** por cliente (resumo em `bot_leads.context.memoria`),
responde em **bolhas** com "digitando..." e agrupa mensagens picadas (debounce 5s).

Regressão: `npm run eval` roda a bateria de cenários pelo motor (sem WhatsApp).

---

## URLs

| O que é | URL |
|---|---|
| **Bot API (este projeto)** | `https://bot-fluxo.vercel.app` (ou o domínio configurado na Vercel) |
| **Site/catálogo** | Projeto separado na Vercel — o bot NÃO depende desta URL para funcionar |
| **Webhook WhatsApp** | `https://bot-fluxo.vercel.app/webhook` ← configurar no provider (Evolution API / Meta) |

O bot é uma API Express pura. Não chama nenhuma URL do site para responder mensagens.

---

## Variáveis de ambiente (Vercel)

| Variável | O que é |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase (mesmo do site) |
| `SUPABASE_SERVICE_KEY` | service_role key — para escrita nas tabelas bot_* |
| `SITE_SUPABASE_URL` | Mesma URL acima — usada pelo InventoryBridge para ler produtos |
| `SITE_SUPABASE_ANON_KEY` | anon key — leitura do catálogo (tabela products) |
| `LOJA_WHATSAPP` | Número da loja: `5534984148067` |
| `IGNORAR_HORARIO` | `true` para ignorar horário comercial (obrigatório em testes) |
| `AI_ASSIST_PROVIDER` / `AI_ASSIST_KEY` | Liga a IA (Gemini). Com IA ligada o bot vira AGENTE: busca produtos, salva lead no CRM e chama atendente sozinho (function calling) |
| `AI_ASSIST_MODEL_FALLBACK` | Modelo reserva quando o principal falha (default `gemini-2.0-flash`) |
| `BOT_AUTO_REPLY` | **`true` = bot responde sozinho no WhatsApp real** (Baileys). Desligado por padrão. Inclui debounce 5s de mensagens picadas, "digitando..." e transcrição de áudio |
| `FOLLOWUP_ATIVO` | `true` = follow-up automático de leads abandonados (45min–24h, máx 5/ciclo). Desligado por padrão |

---

## Rodar localmente

```bash
cp .env.example .env
# Preencha as variáveis acima no .env

npm install
npm run dev
```

Painel: **http://localhost:3000**

---

## Testar `/api/health`

```bash
curl https://bot-fluxo.vercel.app/api/health
```

Resposta esperada:
```json
{ "ok": true, "service": "bot-api", "env": "production" }
```

---

## Testar `/api/chat`

```bash
curl -X POST https://bot-fluxo.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{ "phone": "5534999999999", "message": "oi" }'
```

Resposta esperada:
```json
{ "ok": true, "reply": "Olá! Seja bem-vindo à Fluxo Outlet! ..." }
```

---

## Configurar webhook (quando tiver WhatsApp real)

1. **Evolution API**: no painel da Evolution, configure o webhook de `MESSAGES_UPSERT` para `https://bot-fluxo.vercel.app/webhook`
2. **Meta Cloud API**: no painel do Meta for Developers, configure o webhook para `https://bot-fluxo.vercel.app/webhook`

O `parseWebhookPayload()` em `src/providers/messaging.ts` já está mapeado para o formato da Evolution API.

---

## Endpoints

| Método | URL | Descrição |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/chat` | Chat (body: `{phone, message}`) |
| `POST` | `/webhook` | Webhook do provider WhatsApp |
| `GET` | `/` | Painel visual |
| `GET` | `/api/sessions` | Sessões ativas |
| `GET` | `/api/leads` | Leads qualificados |
| `GET` | `/api/messages/:phone` | Histórico de mensagens |
| `POST` | `/start` | Iniciar chat (painel) |
| `POST` | `/reset` | Resetar sessão (painel) |
| `POST` | `/send` | Envio manual (painel) |

---

## Arquitetura

```
src/
├── app.ts                    # Express — rotas principais
├── lib/supabase.ts           # Cliente Supabase (service_role)
├── services/
│   ├── chatService.ts        # Entrada limpa: phone + message → reply
│   ├── storeService.ts       # Lookup da loja pelo LOJA_WHATSAPP
│   ├── sessionService.ts     # CRUD de sessões
│   ├── leadService.ts        # Registro de leads
│   └── mensagemService.ts    # Histórico de mensagens
├── bot/
│   ├── engine.ts             # Motor de fluxo de decisão
│   └── flowMap.ts            # Árvore de nós do bot
├── providers/messaging.ts    # sendMessage() — stub (trocar por Evolution/Meta)
└── inventory/inventoryBridge.ts  # Leitura do catálogo (READ-ONLY)
```

---

## Fluxo principal

```
INICIO
├── catálogo    → CATALOGO → QUALIFICACAO_NOME → QUALIFICACAO_INTERESSE
│                                                        ↓
│                                              LEAD_REGISTRADO → ENCAMINHAR_HUMANO
├── pedido      → CONSULTA_PEDIDO → ENCAMINHAR_HUMANO
├── atendente   → SUPORTE → ENCAMINHAR_HUMANO
└── *           → NAO_ENTENDI → INICIO
```

Para expandir o fluxo: edite `src/bot/flowMap.ts`.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com hot-reload |
| `npm run build` | Compila para `dist/` |
| `npm start` | Produção (requer build) |

---

## SQL

Antes do primeiro deploy, rode `BOT_RESET_CLEAN.sql` no SQL Editor do Supabase.
Ele cria todas as tabelas do bot sem tocar em `products`, `orders` ou qualquer tabela do site.
