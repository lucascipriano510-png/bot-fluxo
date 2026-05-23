# bot-fluxo

Bot de WhatsApp independente com fluxo de conversa em árvore de decisão.
Painel de comando visual incluso. Banco Supabase próprio, separado do site.

---

## Pré-requisitos

- Node.js 18+
- Conta Supabase (projeto separado do site)
- SQL `BOT_SUPABASE_SETUP.sql` executado no projeto Supabase do bot

---

## Configuração

```bash
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_SERVICE_KEY, LOJA_WHATSAPP, LOJA_NOME
```

---

## Rodar localmente

```bash
npm install
npm run dev
```

Abra no navegador: **http://localhost:3000**

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com hot-reload |
| `npm run simulate` | Conversa no terminal (interativo) |
| `npm run build` | Compila para `dist/` |
| `npm start` | Produção (requer build) |

---

## Painel visual — http://localhost:3000

| Aba | O que mostra |
|---|---|
| **Sessões** | Sessões ativas, nó atual, contexto |
| **Leads** | Leads qualificados com status |
| **Testar** | Simulador de conversa no navegador |

---

## Endpoints

| Método | URL | Descrição |
|---|---|---|
| `GET` | `/` | Painel visual |
| `GET` | `/status` | Health check |
| `GET` | `/api/sessions` | Sessões |
| `GET` | `/api/leads` | Leads |
| `GET` | `/api/messages/:phone` | Histórico |
| `POST` | `/send` | Teste manual |
| `POST` | `/reset` | Reseta sessão |
| `POST` | `/webhook` | Webhook do provider |

---

## Mapa mental

```
INICIO
├── catálogo    → CATALOGO → QUALIFICACAO_NOME → QUALIFICACAO_INTERESSE
│                                                        ↓
│                                              LEAD_REGISTRADO → ENCAMINHAR_HUMANO
├── pedido      → CONSULTA_PEDIDO → ENCAMINHAR_HUMANO
├── atendente   → SUPORTE → ENCAMINHAR_HUMANO
└── *           → NAO_ENTENDI → INICIO
```

Para expandir o fluxo, edite `src/bot/flowMap.ts`.
