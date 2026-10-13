# Guia de teste completo, do PC ligado até aplicar na main

Custo esperado em modo REAL: **cerca de US$ 0,10 a 0,20** no total. Os limites padrão (US$ 2/dia, US$ 20/mês, US$ 0,50/task) protegem. Para ensaiar sem gastar, use `iniciar-mock.cmd` (o Developer não altera arquivos em mock).

## 0. Ligar o sistema
1. Abra o Explorador de Arquivos em `C:\xampp\htdocs\orquestradoria` (o XAMPP **não** precisa estar ligado).
2. Dê duplo clique em **`iniciar-real.cmd`**, digite `SIM` e Enter.
3. Se aparecer `[AVISO] Node atual: v24`: feche, abra o Prompt de Comando, rode `nvm use 22.23.3` e repita o passo 2.
4. Aguarde 30–60 s até aparecer `API listening on http://127.0.0.1:4000` e `Local: http://localhost:5173/`. Não feche a janela preta.
5. Abra o navegador em **http://localhost:5173**.

## 1. Conferir o custo antes de começar
- Topo direito: faixa vermelha **REAL · consome créditos**.
- **Configurações → Limites de gasto**: 2 / 20 / 0,5.
- **Custos → Recomendação econômica** → escolha **"Configuração global"** → clique em **Aplicar configuração econômica** e confirme. **Não pule este passo**: sem ele o Developer roda em **Claude Sonnet 5.5**, cerca de 10x mais caro (US$ 0,12 a 0,17 por rodada, contra ~US$ 0,015 no Haiku). Depois confira o topo: a faixa deve dizer **Developer: Claude Haiku 5.5** (sem "⚠ caro").
- A configuração é **congelada quando a missão/task é criada**: mudar depois não afeta o que já existe. Faça este passo **antes** de criar o projeto.

## 2. Criar o projeto a partir de uma ideia
**Workspaces → Novo workspace → aba "Novo projeto a partir de uma ideia"**:
- Nome: `teste-processo` · Pasta: `C:\xampp\htdocs`
- Ideia: `Página de lista de tarefas em HTML, CSS e JavaScript puros: campo e botão Adicionar, checkbox para concluir (texto riscado), botão Excluir, contador de pendentes e salvar no localStorage. Visual limpo e responsivo, título "Minhas tarefas".`
- **Criar projeto** → abre o workspace com a Missão e o botão **Gerar plano**.

## 3. Missão: plano → aprovar → executar
1. **Gerar plano** (agora o planner é o Claude Haiku 5.5, ~US$ 0,01; para um pedido simples deve propor de 1 a 3 etapas). Veja a estimativa de custo na tela e, se o plano vier com muitas etapas, **enxugue antes de aprovar**: cada etapa roda Developer + Reviewer.
2. **APROVAR PLANO** → confirmar → **INICIAR MISSÃO** → confirmar.
3. Acompanhe ("Trabalhando", etapas ✓) até **Trabalho concluído** (2–4 min).

## 4. Ver o resultado e pedir ajuste
1. Card **Preview e ajustes → Abrir preview**: teste o app (adicionar, marcar, recarregar). **Parar preview**.
2. **VER ALTERAÇÕES** lista os arquivos.
3. No campo de ajuste: `Deixe o título em verde e adicione um botão "Limpar concluídas".` → **Solicitar ajuste** → aguarde a etapa **Ajuste 1** → preview de novo.

## 5. Aplicar
**APLICAR NA main** → confirmar → "APLICADO NA main". Confira `C:\xampp\htdocs\teste-processo` (index.html, app.js…) e `git log` nessa pasta.

## 6. Task avulsa com o Refinador
No workspace: **Nova task** → `adicionar botão para exportar as tarefas em JSON` → **Refinar solicitação** → revise → (opcional) **Usar US$ … como limite** → **Criar task** → **Executar pipeline** → Planner → Developer → Tester → Reviewer → "Aprovada · aguardando sua ação" → preview/ajuste/aplicar.

## 7. Conferir custos e operação
- Quadro de trabalho do workspace (custo, tokens, arquivos).
- **Custos → Gasto real**: total ~US$ 0,10–0,20, sem "custo desconhecido".
- **Configurações**: backup do banco e limpeza de pastas.

## 8. Desligar
Na janela preta: `Ctrl+C` (responda `S`) ou feche a janela.

## Se algo der errado
| Sintoma | O que fazer |
|---|---|
| Janela fecha sozinha | Rode `iniciar-real.cmd` pelo Prompt de Comando para ver o erro; confira `node -v` (precisa v22) |
| Página em branco / "Desconectado" | Aguarde o build terminar na janela preta e dê F5 |
| Porta 4000 ou 5173 ocupada | Feche outras janelas do sistema e tente de novo |
| "Limite diário/mensal atingido" | Configurações → Limites de gasto |
| Missão parou em "Preciso de você" | Abra a missão e leia a mensagem. Se o Reviewer aprovou na 2ª rodada mas a etapa ficou parada, reinicie o iniciar-real.cmd (a correção repara sozinha) e clique em **RETOMAR MISSÃO** |
| Developer ou Reviewer falha | Abra a task → Execuções; confirme que `claude` e `codex` estão logados num terminal |
