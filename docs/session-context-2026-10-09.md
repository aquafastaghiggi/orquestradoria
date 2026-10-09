# Contexto da sessão — Orquestradoria

Data: 2026-10-09

## 1. Objetivo do projeto

A Orquestradoria está sendo construída como um funcionário de desenvolvimento assistido por IA, capaz de receber uma solicitação de alto nível, refiná-la, planejar, implementar, testar, revisar e devolver o resultado para aprovação humana.

Fluxo principal atual:

Planner -> Developer -> Tester -> Reviewer

Também existe Modo Funcionário / Missions para solicitações maiores, com decomposição em etapas, execução autônoma e worktree compartilhado.

Princípios do produto:

- nunca trabalhar diretamente na branch principal durante execução;
- usar branch/worktree isolados;
- preservar histórico e audit trail;
- permitir Apply/Discard somente após revisão;
- não fazer push/deploy/destrutivo automaticamente;
- permitir Resume seguro;
- suportar múltiplos providers;
- manter configuração congelada por task;
- produzir evidências factuais dos testes.

## 2. Repositório e ambiente

Repositório:

aquafastaghiggi/orquestradoria

Local principal:

C:\xampp\htdocs\orquestradoria

Workspace real usado na homologação:

C:\xampp\htdocs\mapa-ai

Stack principal:

- Node.js 22
- pnpm
- TypeScript
- Vite
- API + Web
- SQLite
- SSE
- Git worktrees
- Claude Code como Developer
- Command Tester como Tester
- Mock como Planner/Reviewer durante homologação
- Codex CLI também suportado

Branch efetiva do workspace Mapa AI:

master

Observação recorrente:

o workspace está configurado como main, mas o repositório real usa master. A UI mostra o warning e usa master como branch efetiva.

## 3. Arquitetura atual

Estrutura aproximada:

orchestrator/
  apps/
    web/
    api/
  packages/
    core/
    adapters/
    workspace/
    shared/
  storage/local/
  docs/

Hierarquia funcional:

Workspace -> Mission -> Tasks -> Executions

### Task

Uma Task possui:

- descrição;
- pipeline;
- snapshot de providers/modelos;
- snapshot de execution policies;
- limite de tokens/custo;
- branch/worktree isolado;
- executions;
- artifacts;
- events;
- audit logs;
- Apply/Discard;
- Resume.

### Mission

Uma Mission possui:

- Mission Planner;
- plano de tarefas;
- aprovação humana inicial;
- child tasks;
- worktree único compartilhado;
- execução autônoma sequencial;
- waiting_human;
- Resume;
- Apply/Discard no nível da missão.

## 4. Funcionalidades já homologadas

### Pipeline multiagente

Homologado:

- Planner
- Developer
- Tester
- Reviewer
- retry técnico;
- Auto-Fix;
- ReviewBundle;
- Resume;
- cancellation;
- observabilidade;
- snapshots;
- limits/budgets.

### Git isolation

Homologado:

- task branch;
- Git worktree;
- frozen base commit;
- Apply;
- Discard;
- proteção contra workspace sujo;
- proteção contra base branch avançada;
- diff completo incluindo arquivos untracked;
- cleanup idempotente após Apply;
- recuperação de Apply parcialmente concluído.

### Project Context

O contexto técnico do projeto é anexado por etapa.

A UI mostra:

- versão;
- status;
- quantidade de caracteres;
- commit analisado;
- conteúdo utilizado;
- truncamento.

### Missions

Phase 4.1 e Phase 4.2 foram implementadas e homologadas.

O Mission Planner real com Claude conseguiu decompor uma missão do Mapa AI em 9 etapas.

A execução real completou as 9 etapas em um worktree compartilhado.

## 5. Browser QA / Runtime Session — Fase 5.2

A Fase 5.2 foi homologada em 2026-10-09.

O objetivo foi dar ao funcionário capacidade real de abrir e validar uma aplicação local no navegador antes de Apply.

### Runtime Session

O Orquestradoria detecta e sobe runtime local para o workspace.

No Mapa AI foi usado runtime static/local.

A UI mostra:

- runtime;
- URL temporária;
- recursos externos;
- HTTP status;
- screenshots.

### Browser Smoke QA

Homologado:

- abrir rotas;
- validar HTTP 2xx;
- screenshot;
- detectar erros;
- detectar requests locais quebrados;
- detectar responses >= 400.

### Browser Interactive QA

Homologado:

- goto;
- click;
- fill;
- reload;
- expectVisible;
- expectHidden;
- expectText;
- expectValue;
- expectCount;
- screenshot;
- diálogo nativo esperado;
- confirmação de exclusão;
- mesmo BrowserContext/localStorage dentro do cenário.

Restrições de segurança:

- sem page.evaluate;
- sem JavaScript arbitrário;
- sem XPath;
- sem navegação externa;
- sem HTTP write;
- sem auto-accept global de dialogs;
- dialogs só são aceitos quando declarados no plano.

### Dialogs

O Browser QA agora suporta:

{
  action: "click",
  target: {
    role: "button",
    name: "Excluir"
  },
  dialog: {
    action: "accept"
  }
}

Error types estruturados:

- unexpected_dialog
- expected_dialog_missing
- dialog_message_mismatch

## 6. Acceptance Criteria Coverage

Também homologado.

Uma task pode ter:

Critérios de aceite:
- ...
- ...

O sistema gera IDs estáveis:

AC1
AC2
AC3
...

O Developer recebe explicitamente os IDs no prompt.

O Developer propõe um acceptanceCoveragePlan.

O Tester é a fronteira de confiança e valida evidências reais.

Evidence types:

- browser_step
- workspace_no_changes
- command_qa_passed
- browser_smoke_passed
- browser_interactive_passed
- browser_no_runtime_errors
- browser_screenshot_generated

### Regras importantes

O Developer apenas propõe a evidência.

O Tester verifica factual.

browser_step só vale quando aponta para assertion aprovada:

- expectVisible
- expectHidden
- expectText
- expectValue
- expectCount

click/fill/goto/reload não são prova isolada.

Evidência de uma assertion já aprovada continua válida mesmo se um passo posterior do cenário falhar.

### UI

A UI agora mostra cobertura por critério:

- AC1
- AC2
- ...
- status;
- cenário;
- step;
- action;
- target;
- expected summary;
- screenshot quando aplicável.

## 7. Homologação final real da Fase 5.2

Task:

Homologação final do funcionário Browser QA 1

Workspace:

Mapa AI

Objetivo:

validar CRUD de POIs sem alterar arquivos do projeto.

Critérios:

AC1 Nenhum arquivo do projeto alterado.
AC2 Browser Smoke QA aprovado.
AC3 Browser Interactive QA executado e aprovado.
AC4 Criação do POI confirmada por assertion.
AC5 Persistência após reload confirmada por assertion.
AC6 Edição confirmada por assertion.
AC7 Exclusão confirmada por assertion posterior.
AC8 Nenhum erro JavaScript/request local quebrado/HTTP local >= 400.
AC9 Pelo menos um screenshot gerado.

Resultado final:

9/9 critérios verificados.

Também foi confirmado:

- arquivos alterados = 0;
- Developer concluído;
- Tester concluído;
- Reviewer concluído;
- task aprovada;
- Apply ficou disponível somente depois da cobertura 9/9.

Esse teste é a homologação funcional da Fase 5.2.

## 8. Bugs importantes encontrados e corrigidos na sessão

### Resume inconsistente

A UI dizia Developer, mas runTask podia iniciar Reviewer.

Corrigido com fonte única de verdade para Resume.

### Approval integrity fraca

Reviewer antigo podia ser reutilizado depois de falha posterior.

Corrigido com validação temporal da cadeia final.

A aprovação válida exige uma sequência coerente entre Developer, Tester e Reviewer.

### Claude structured output

Claude retornava JSON com ruído textual e o parser falhava.

Corrigido com parser robusto de JSON:

- JSON puro;
- envelope;
- fenced JSON;
- JSON embutido;
- scanner balanceado;
- strings/escapes;
- rejeição de ambiguidade.

### Apply parcialmente concluído

Merge podia acontecer e cleanup falhar por lock do Windows.

Corrigido com Apply idempotente e cleanup separado.

### Diff sem arquivos untracked

A UI listava untracked, mas o patch não os mostrava.

Corrigido com diff sintético de untracked e reviewComplete.

### Interactive Browser QA plan inválido

Foram corrigidos problemas de schema e validação.

### Dialog inesperado na exclusão

O CRUD chegava até Excluir e falhava com:

Unexpected dialog appeared

Foi adicionado suporte explícito a expected dialogs.

### Resume após Tester funcionalmente FAILED

Task mostrava Retomar do Tester.

Corrigido:

- falha técnica do Tester -> Tester;
- Tester execution completed + structuredResult FAILED -> Developer.

### Evidência factual incorreta

A UI mostrava contagem 0 para assertions que tinham outro valor.

Corrigido preservando metadata factual do BrowserScenarioStepResult.

Commit mais recente desse ajuste:

ff1f97479e5e8794a693d6555ea107e400063839
fix: preserve browser assertion evidence metadata

## 9. Commits relevantes desta sessão

Principais commits recentes em ordem aproximada:

- 5b30aae — include untracked files in mission diff review
- 6562487 — make mission resume reuse failed child task
- 29714c5 — repair mission child task links
- 5861634 — make modal stacking reliable
- cca4078 — robustly parse claude structured output
- 7995b35 — verify acceptance criteria coverage
- 63cec61 — make acceptance coverage explicit and verifiable
- a34c527 — wire acceptance criteria into developer prompt
- 23302bd — show frozen browser QA policies in task config
- a5a9522 — support expected dialogs in browser QA plans
- e9f6309 — resume developer after functional tester failure
- ff1f974 — preserve browser assertion evidence metadata

## 10. Estado atual

Estado atual do produto:

- Fase 5.2 homologada;
- Browser QA real funcionando;
- Acceptance Coverage funcionando;
- Resume seguro;
- Auto-Fix funcionando;
- Reviewer protegido por approval integrity;
- worktree/branch isolation funcionando;
- task pode ser aprovada sem alterar arquivos quando a solicitação é apenas QA.

## 11. Foco definido pelo usuário para a próxima etapa

O foco agora NÃO é adicionar recursos aleatórios.

O objetivo é fechar a experiência principal de uso diário:

1. apontar uma pasta/projeto para o Orquestradoria e começar a usar;
2. visualizar histórico de tasks e o que foi feito;
3. visualizar o resultado no navegador antes de aplicar na branch principal;
4. escrever um prompt;
5. lapidar/refinar o prompt;
6. executar;
7. acompanhar;
8. visualizar resultado;
9. testar;
10. solicitar correção;
11. repetir no mesmo ambiente;
12. somente depois aplicar no Git principal.

A experiência desejada deve parecer um funcionário real.

Fluxo alvo:

Workspace
-> Nova solicitação
-> Prompt Refiner
-> Aprovar prompt
-> Executar
-> Acompanhar
-> Preview no navegador
-> Evidências / Diff / QA
-> Solicitar ajuste OU Aplicar OU Descartar

## 12. Próximas funcionalidades prioritárias

### A. Workspace onboarding simples

O usuário precisa conseguir apontar uma pasta local existente, por exemplo:

C:\xampp\htdocs\meu-projeto

O Orquestradoria deve:

- validar a pasta;
- detectar Git;
- detectar branch;
- detectar stack/runtime;
- analisar Project Context;
- mostrar readiness;
- permitir criar task imediatamente.

### B. Histórico real de trabalho

Tela por workspace com:

- tasks;
- missions;
- status;
- data;
- prompt original;
- prompt refinado;
- arquivos alterados;
- screenshots;
- QA;
- review;
- Apply/Discard;
- duração;
- tokens/custo;
- branch/worktree;
- resultado final.

### C. Preview antes do Apply

O usuário quer abrir a versão da task no navegador ANTES de aplicar na branch principal.

O preview deve usar o worktree isolado da task.

Ideal:

- botão Abrir preview;
- Start/Stop runtime;
- URL;
- abrir em nova aba;
- screenshot;
- estado do runtime;
- não tocar na master;
- preview persistente enquanto a task estiver aguardando decisão.

### D. Human feedback / Solicitar ajuste

Na task aprovada ou aguardando ação:

Ações:

- Aplicar
- Solicitar ajuste
- Descartar

Solicitar ajuste abre um campo:

"Reduza o botão em 20% e altere o texto."

O sistema deve:

- preservar o mesmo worktree;
- registrar feedback;
- voltar para Developer;
- executar Tester;
- executar Browser QA;
- recalcular Acceptance Coverage;
- Reviewer;
- voltar para decisão humana.

Sem criar nova task manualmente.

### E. Prompt Refiner como etapa de entrada

Já existe uma ideia de Prompt Refiner.

O fluxo final deve permitir:

Prompt bruto
-> Refinar solicitação
-> usuário edita
-> confirmação
-> task criada com prompt final

O Refiner não deve alterar configuração do Developer.

### F. Preview + evidência lado a lado

Idealmente a task deve mostrar:

- Preview;
- Diff;
- QA;
- Acceptance Coverage;
- Logs;
- Screenshots;
- Review.

Assim o usuário consegue decidir Apply sem sair da Orquestradoria.

## 13. Critério de produto para considerar a experiência principal pronta

A experiência principal estará pronta quando for possível:

1. cadastrar um workspace apontando para uma pasta real;
2. escrever um prompt simples;
3. refinar o prompt;
4. executar o funcionário;
5. abrir a aplicação gerada em preview;
6. revisar diff;
7. executar/consultar QA;
8. ver critérios de aceite;
9. solicitar ajustes em linguagem natural;
10. repetir correção e QA no mesmo worktree;
11. aprovar;
12. aplicar na branch principal;
13. consultar depois todo o histórico da task.

Esse deve ser o foco das próximas fases.
