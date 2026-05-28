# Fluxo Command — Constituição do Projeto

## 1. Visão

O Fluxo Command é um sistema operacional de vendas por WhatsApp para negócios locais.

Ele não é apenas um bot, um painel ou um catálogo. Ele deve evoluir para um Agent OS comercial, combinando:

- Painel SaaS
- Bot de WhatsApp
- Catálogo inteligente
- Estoque adaptável
- CRM de leads e conversas
- Motor comercial
- Follow-up
- Métricas
- Segurança multi-tenant

A visão final é:

Cliente manda mensagem
→ Bot identifica intenção
→ Motor de catálogo/estoque consulta produtos, serviços, kits ou orçamentos
→ Motor comercial escolhe o melhor argumento
→ Motor de CRM salva lead e histórico
→ Motor de follow-up agenda retorno
→ Motor de métricas mede conversão
→ Painel mostra tudo para o dono da loja
→ Claude Code ajuda a manter e evoluir o sistema com segurança

## 2. Regra de Ouro

Trabalhar sempre passo a passo.

Antes de qualquer alteração relevante:

1. Entender o estado atual.
2. Definir o objetivo do passo.
3. Fazer a menor mudança segura possível.
4. Testar o resultado real.
5. Só então decidir o próximo passo.

Não tentar prever e resolver tudo de uma vez.
Não aplicar prompts gigantes sem validação.
Não sair da curva do produto.

## 3. O que nunca pode quebrar

Nunca quebrar ou alterar sem confirmação explícita:

- Auth/login
- store_id
- store_users
- stores
- invite_codes
- RLS
- isolamento entre lojas
- Supabase production
- variáveis de ambiente
- webhooks
- regras de ativação de loja
- domínio de produção
- dados reais de clientes ou lojas

## 4. Segurança multi-tenant

O Fluxo Command é SaaS multi-loja.

Toda informação sensível precisa estar vinculada a uma loja.

Regra central:

- Usuário pertence a uma loja via store_users.
- Loja é representada por stores.
- Dados operacionais devem ser filtrados por store_id.
- Frontend nunca deve escolher store_id manualmente.
- Nenhuma loja pode ver dados de outra loja.
- Qualquer mudança em RLS exige explicação antes de executar.

## 5. Motor de Catálogo Inteligente

O sistema não deve tratar produto como simples cadastro manual.

A visão correta é criar um Motor de Catálogo Inteligente capaz de receber itens vendáveis de várias origens:

- Painel
- Bot
- Site atual
- Desktop
- Planilhas
- APIs
- Importações futuras
- Catálogos externos

O motor deve normalizar diferentes tipos de item vendável:

- Produto físico
- Produto com variações
- Kit/combo
- Serviço
- Orçamento
- Item importado
- Item que precisa de revisão

O objetivo não é apenas cadastrar produto.
O objetivo é transformar qualquer estoque ou catálogo em algo que o bot consiga entender, consultar e vender.

## 6. Papel do Claude Code

Claude Code deve agir como arquiteto e operador técnico do projeto.

Ele deve:

- Propor antes de alterar.
- Pedir confirmação antes de mexer em banco, auth, RLS ou produção.
- Evitar mudanças grandes demais.
- Preservar a arquitetura SaaS.
- Procurar riscos de segurança.
- Separar visual, backend, banco e lógica de negócio.
- Explicar o impacto de cada alteração.

Claude Code não deve:

- Criar migrations sem mostrar antes.
- Mexer em RLS sem confirmação.
- Inserir secrets no frontend.
- Usar store_id hardcoded.
- Criar tabelas duplicadas.
- Recriar schema do zero.
- Resolver problemas por chute.
- Trocar arquitetura sem discutir.

## 7. Prioridade atual

A prioridade atual é estabilizar a fundação do Fluxo Command como SaaS seguro e depois evoluir os motores internos.

Ordem mental:

1. Fundação SaaS segura
2. Motor de catálogo inteligente
3. Bot WhatsApp operacional
4. CRM e conversas
5. Follow-up
6. Métricas
7. Agent OS com subagentes, hooks, skills e MCP quando fizer sentido
