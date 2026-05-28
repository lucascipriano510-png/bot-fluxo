# /sprint — Esteira de execução de sprint do Fluxo Command

Quando o usuário invocar /sprint, execute a sequência abaixo para qualquer tarefa de produto, UI, catálogo ou lógica de bot.

## Sequência obrigatória

**1. Entender**
- Leia os arquivos relevantes antes de qualquer alteração.
- Se a tarefa tocar banco, RLS, auth, migrations, store_id ou secrets: pare e peça confirmação antes de continuar.
- Se a tarefa tocar arquitetura de catálogo: consulte o catalog-engine-architect.
- Se houver risco de segurança: acione o security-guardian.

**2. Planejar**
- Liste o plano em 3 a 5 bullet points.
- Indique exatamente quais arquivos serão alterados.
- Se o escopo for grande demais, divida em passos menores.

**3. Implementar**
- Execute a menor mudança segura que atinge o objetivo.
- Sem refatorações especulativas. Sem abstrações desnecessárias.
- Sem features extras. Sem backwards-compatibility hacks.

**4. Verificar**
- Rode `npm run build` — pare se falhar.
- Rode `npm run check:sensitive` — pare se detectar risco.

**5. Resumir**
- Liste arquivos alterados com contagem de linhas.
- Explique o que mudou e por quê.
- Aponte riscos, se houver.
- Informe se a tarefa é segura para safe-ship ou exige confirmação manual.

## Quando usar safe-ship

Após o sprint, se a tarefa for de produto/UI/bot normal e não tocar em nada sensível:

```
npm run safe-ship -- "mensagem descritiva"
```

## Quando NÃO usar safe-ship (exige confirmação explícita)

- Qualquer mudança em Supabase, RLS, auth, migrations
- Qualquer mudança em store_id, store_users, stores, invite_codes
- Qualquer mudança em webhooks ou variáveis de ambiente
- Qualquer push para produção ou alteração de domínio
- Qualquer mudança em dados reais de clientes ou lojas

## Subagentes disponíveis

- **security-guardian** — revisar risco antes de mudanças sensíveis
- **catalog-engine-architect** — revisar arquitetura do Motor de Catálogo
- **product-builder** — executar tarefas de produto, UI, catálogo e bot
