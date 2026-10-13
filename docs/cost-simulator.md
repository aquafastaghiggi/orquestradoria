# Simulador e controle de custos

Atualizado em 2026-10-13. Tela: menu **Custos**. Código: `packages/shared/src/pricing.ts` (tabela + cálculo), `apps/api/src/cost-resolution.ts`, `cost-estimator.ts`, `apps/web/src/CostsPage.tsx`.

## Como o custo é calculado

**Sempre por tokens × tabela oficial de preços** (USD por 1M de tokens), não pelo valor que o CLI informa.

- Tabela: `DEFAULT_PRICING` (conferida em **2026-10-13** nas páginas oficiais da Anthropic, OpenAI e Cursor — links na tela). Para ajustar sem mexer no código, aponte `PRICING_FILE` para um JSON com entradas por `id` (mescla sobre a padrão; entradas inválidas são ignoradas).
- Cada execução grava `estimatedCost` (calculado), `reportedCost` (o que o provider informou), `costSource` (`computed | provider_reported | mixed | mock | unknown`), `actualModel` e `usageDetails` (tokens por modelo).
- Modelo sem preço na tabela → usa o valor do provider e marca `mixed/provider_reported`; sem nenhum dado → `unknown` (a tela mostra N/D, nunca um falso zero).

### Por que não confiar no custo do CLI

Medido em 2026-10-13: para `claude-haiku-5-5` o Claude Code informou **US$ 0,426** com `costBasis: "unknown"` (aplicou uma tarifa de modelo caro, ~US$ 8/M de cache). Pela tabela oficial o custo real foi **~US$ 0,011**. Para um modelo que o CLI conhece (`costBasis: "list"`, Haiku 4.5), a tabela reproduz o valor do CLI até a 7ª casa (US$ 0,10229). Divergências viram auditoria `execution.cost_mismatch` e aparecem no painel.

### Convenções de tokens
- Anthropic: `input_tokens` **exclui** cache; escrita de cache 5 min / 1 h e leitura de cache têm taxas próprias.
- OpenAI/Codex: `input_tokens` **inclui** o cache (`cached_input_tokens`); normalizado por `openAiUsageToBreakdown`.
- Contexto longo: Haiku 5.5 acima de 100 mil tokens por prompt (5x); modelos GPT-5.x acima de 272 mil. Usa `maxPromptTokens` ou total/`requests`.
- O Claude Code usa mais de um modelo por sessão (ex.: Haiku 4.5 para tarefas auxiliares); cada um é precificado separadamente.

## Modelos mais econômicos (tabela de 2026-10-13)

| Papel que o orquestrador executa | Ferramenta | Mais barato | US$/M (entrada / saída) |
|---|---|---|---|
| Developer | Claude Code | **Claude Haiku 5.5** (`claude-haiku-5-5`, verificado) | 0,10 / 0,50 |
| Reviewer | Codex CLI | **GPT-5.6 Luna** (`gpt-5.6-luna`, verificado) | 0,20 / 1,20 |

- O alias `haiku` do Claude Code resolveu para **Haiku 4.5** (US$ 1 / 5): ~10x mais caro que o Haiku 5.5. Prefira o ID explícito `claude-haiku-5-5`.
- Sessão do Claude Code ≈ 40–53 mil tokens de cache só para iniciar → ~US$ 0,011 no Haiku 5.5, ~US$ 0,11 no Haiku 4.5, ~US$ 0,21 no Sonnet 5.5.
- Hoje o orquestrador só executa Developer = Claude Code e Reviewer = Codex (o Planner roda em mock). Cursor ainda não tem adapter: entra só como **informativo** (Composer 2.5 US$ 0,5 / 2,5; modelos de terceiros no Cursor cobram preço de API).

## Estimativa

`POST /api/costs/estimate` → `{estimado, faixa baixa/alta, base, comparação, avisos}`.
- **CLI (agente):** perfil de tokens por ferramenta e tamanho (pequena/média/grande). O perfil "pequeno" do Claude Code é uma medição real. Com **≥ 3 execuções reais** do mesmo provider/papel, passa a usar a mediana e os percentis 25/90 do histórico.
- **API (chamada direta):** o usuário informa tokens do prompt, % em cache e tokens de saída.
- Faixa padrão sem histórico: 0,5x a 2,5x. É estimativa de ordem de grandeza; estreita com o uso real.
- Valores são **equivalentes ao preço de API**. Em assinatura (Claude Pro/Max, ChatGPT, Cursor) o desembolso real é fixo/mensal.

## Endpoints

| Rota | Uso |
|---|---|
| `GET /api/pricing` | tabela, fontes, data e planos do Cursor |
| `POST /api/costs/estimate` | simulador e comparação entre modelos |
| `GET /api/costs/summary?workspaceId&days` | gasto real por modelo/papel/dia, execuções sem custo e divergências |
| `GET /api/costs/recommendation?workspaceId` | modelo mais barato utilizável por papel (ignora `ORQ_FORCE_MOCK`) |

"Aplicar configuração econômica" grava a configuração (global ou do workspace) para **tasks novas**; nada muda sozinho.

## Pendências
- Estimativa de custo dentro do modal de criação de task/missão.
- Custo do Planner de missão e do Refinador (Claude Code) ainda não é contabilizado.
- Perfis `medium`/`large` são extrapolações até haver histórico real.
- Adapter do Cursor (somente informativo por ora).
