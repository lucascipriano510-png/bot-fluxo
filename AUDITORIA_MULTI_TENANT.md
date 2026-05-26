# Auditoria Multi-Tenant — bot-fluxo

## 1. Tabelas Alteradas (SQL: BOT_SUPABASE_MIGRATION_5.sql)

| Tabela | Coluna adicionada | Constraint antiga | Constraint nova |
|---|---|---|---|
| `bot_sessions` | `store_id uuid NOT NULL REFERENCES stores(id)` | `UNIQUE(phone)` | `UNIQUE(store_id, phone)` |
| `bot_mensagens` | `store_id uuid NOT NULL REFERENCES stores(id)` | — | — |
| `bot_leads` | `store_id uuid NOT NULL REFERENCES stores(id)` | `UNIQUE(phone)` | `UNIQUE(store_id, phone)` |
| `bot_optouts` | `store_id uuid NOT NULL REFERENCES stores(id)` | `UNIQUE(phone)` | `UNIQUE(store_id, phone)` |
| `bot_flow_config` | `store_id uuid NOT NULL REFERENCES stores(id)` | `UNIQUE(node_id)` | `UNIQUE(store_id, node_id)` |

Tabelas que já tinham `store_id` (migration 4): `stores`, `products`, `store_bot_settings`, `bot_conversations`, `orders`.

---

## 2. Índices Criados

```sql
idx_bot_sessions_store_phone    → (store_id, phone)
idx_bot_mensagens_store_phone   → (store_id, phone)
idx_bot_leads_store_id          → (store_id)
idx_bot_leads_store_status      → (store_id, status_comercial)
idx_bot_optouts_store_phone     → (store_id, phone)
idx_bot_flow_config_store_node  → (store_id, node_id)
```

---

## 3. Consultas Corrigidas (store_id adicionado)

### sessionService.ts
| Função | Antes | Depois |
|---|---|---|
| `getOrCreateSession` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |
| `getOrCreateSession` (insert) | `{ phone, ... }` | `{ store_id: storeId, phone, ... }` |
| `updateSession` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |
| `resetSession` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |

### leadService.ts
| Função | Antes | Depois |
|---|---|---|
| `registerLead` | `onConflict: 'phone'` | `onConflict: 'store_id,phone'` |
| `fetchLeads` | sem filtro store | `.eq('store_id', storeId)` |
| `fetchLeadsPorStatusComercial` | sem filtro store | `.eq('store_id', storeId)` |
| `updateLeadStatus` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |

### mensagemService.ts
| Função | Antes | Depois |
|---|---|---|
| `saveMensagem` | sem `store_id` no objeto | `store_id: storeId` obrigatório no tipo |
| `fetchHistorico` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |

### optoutService.ts
| Função | Antes | Depois |
|---|---|---|
| `isOptedOut` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |
| `registerOptOut` | `onConflict: 'phone'` | `onConflict: 'store_id,phone'` |
| `registerOptOut` (leads) | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |
| `registerOptOut` (sessions) | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |
| `removeOptOut` | `.eq('phone', phone)` | `.eq('store_id', storeId).eq('phone', phone)` |

### flowConfigService.ts
| Função | Antes | Depois |
|---|---|---|
| `loadFlowConfig` | `select('*')` global | `select('*').eq('store_id', storeId)` |
| cache | global (Map) | por store (`Map<storeId, { data, time }>`) |

### routes/api.ts (todas as rotas)
| Rota | Antes | Depois |
|---|---|---|
| `GET /sessions` | sem filtro | `getStoreContext()` → `.eq('store_id', storeId)` |
| `GET /leads` | sem filtro | `getStoreContext()` → `fetchLeads(storeId)` |
| `GET /messages/:phone` | `fetchHistorico(phone)` | `fetchHistorico(storeId, phone)` |
| `GET /recovery` | sem filtro | `.eq('store_id', storeId)` |
| `GET /flow` | `loadFlowConfig()` global | `loadFlowConfig(storeId)` |
| `GET /flow/config` | sem filtro | `.eq('store_id', storeId)` |
| `POST /flow/config` | upsert sem store_id | upsert com `store_id`, `onConflict: 'store_id,node_id'` |
| `DELETE /flow/config/:nodeId` | `.eq('node_id', id)` | `.eq('store_id', storeId).eq('node_id', id)` |

---

## 4. Hardcodes Removidos

| Local | Antes | Depois |
|---|---|---|
| `inventoryBridge.ts` | `export const DEFAULT_STORE_ID = 'fluxo-outlet'` | Removido |
| `engine.ts` | `DEFAULT_STORE_ID` hardcoded em 2 chamadas | `storeCtx.slug` (do DB) |
| `engine.ts` | `process.env.LOJA_WHATSAPP` para gerar link WA | `storeCtx.whatsappNumber` (do DB) |
| `flowMap.ts` (linha 78) | `"Sou o assistente da *Fluxo Outlet*"` | `ctx._storeName` |
| `flowMap.ts` (linha 179) | `"atendente da Fluxo"` | `ctx._storeName` |
| `flowMap.ts` (linha 212) | `"Conectando com atendente da *Fluxo Outlet*"` | `ctx._storeName` |
| `flowMap.ts` (linha 222) | `"atendente da *Fluxo Outlet*"` | `ctx._storeName` |
| `flowMap.ts` (linha 249) | `"mensagens automáticas da *Fluxo Outlet*"` | `ctx._storeName` |

---

## 5. Novo Serviço: `storeService.ts`

```
getStoreContext(): Promise<StoreContext>
  → lookup por LOJA_WHATSAPP na tabela stores
  → retorna { storeId (UUID), slug, name, whatsappNumber }
  → cacheado em memória (válido até redeploy)
  → lança erro se LOJA_WHATSAPP não encontrado na tabela stores
```

**REGRA MÁXIMA aplicada:** nenhuma consulta ao banco ocorre sem o `store_id` retornado por esta função.

---

## 6. Como Testar Isolamento Entre Lojas

### Pré-requisitos
1. Rodar `BOT_SUPABASE_MIGRATION_5.sql` no Supabase do bot
2. Ter ao menos 2 lojas na tabela `stores`

### Inserir segunda loja de teste
```sql
INSERT INTO stores (slug, name, whatsapp_number, is_active)
VALUES ('loja-teste', 'Loja Teste', '5500000000000', true);
```

### Teste A — Isolamento de sessões
```sql
-- Simular sessão da Fluxo Outlet
INSERT INTO bot_sessions (store_id, phone, current_node, context)
SELECT id, '5534999990001', 'RECOMENDACAO', '{"origem":"camisa"}'
FROM stores WHERE slug = 'fluxo-outlet';

-- Simular sessão da Loja Teste (mesmo telefone!)
INSERT INTO bot_sessions (store_id, phone, current_node, context)
SELECT id, '5534999990001', 'INICIO', '{}'
FROM stores WHERE slug = 'loja-teste';

-- Verificar: cada loja vê apenas sua sessão
SELECT s.slug, bs.phone, bs.current_node
FROM bot_sessions bs JOIN stores s ON bs.store_id = s.id
WHERE bs.phone = '5534999990001';
-- Resultado esperado: 2 linhas, cada uma com seu current_node
```

### Teste B — Isolamento de leads
```sql
-- Verificar que leads da Fluxo Outlet não aparecem para Loja Teste
SELECT count(*) FROM bot_leads
WHERE store_id = (SELECT id FROM stores WHERE slug = 'loja-teste');
-- Resultado esperado: 0 (loja nova, sem leads)

SELECT count(*) FROM bot_leads
WHERE store_id = (SELECT id FROM stores WHERE slug = 'fluxo-outlet');
-- Resultado esperado: total de leads existentes da Fluxo
```

### Teste C — Isolamento de flow config
```sql
-- Config de nó customizada para a Fluxo Outlet
INSERT INTO bot_flow_config (store_id, node_id, message)
SELECT id, 'INICIO', 'Olá da Fluxo!'
FROM stores WHERE slug = 'fluxo-outlet';

-- Verificar que Loja Teste NÃO vê esta config
SELECT count(*) FROM bot_flow_config
WHERE store_id = (SELECT id FROM stores WHERE slug = 'loja-teste');
-- Resultado esperado: 0
```

### Falha crítica
Qualquer query que retorne dados misturados de duas lojas diferentes é uma **falha crítica de isolamento**. Use a consulta abaixo para auditar:

```sql
-- Verificar que não há registros sem store_id
SELECT 'bot_sessions'    AS t, count(*) FROM bot_sessions    WHERE store_id IS NULL
UNION ALL SELECT 'bot_mensagens',   count(*) FROM bot_mensagens   WHERE store_id IS NULL
UNION ALL SELECT 'bot_leads',       count(*) FROM bot_leads       WHERE store_id IS NULL
UNION ALL SELECT 'bot_optouts',     count(*) FROM bot_optouts     WHERE store_id IS NULL
UNION ALL SELECT 'bot_flow_config', count(*) FROM bot_flow_config WHERE store_id IS NULL;
-- Resultado esperado: todas as contagens = 0
```

---

## 7. LGPD Multi-Tenant

O opt-out agora é **por loja**:
- Um cliente que faz opt-out da Fluxo Outlet continua recebendo mensagens de outras lojas
- `registerOptOut(storeId, phone)` apaga leads e reinicia sessão **apenas da loja em questão**
- Isso está em conformidade com a LGPD: o consentimento é por empresa/serviço
