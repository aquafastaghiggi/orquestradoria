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
- **Custos → Recomendação econômica** → "Configuração global" → **Aplicar configuração econômica** (se aparecer). Developer deve ficar em **Claude Haiku 5.5**.

## 2. Criar o projeto a partir de uma ideia
**Workspaces → Novo workspace → aba "Novo projeto a partir de uma ideia"**:
- Nome: `teste-processo` · Pasta: `C:\xampp\htdocs`
- Ideia: `Página de lista de tarefas em HTML, CSS e JavaScript puros: campo e botão Adicionar, checkbox para concluir (texto riscado), botão Excluir, contador de pendentes e salvar no localStorage. Visual limpo e responsivo, título "Minhas tarefas".`
- **Criar projeto** → abre o workspace com a Missão e o botão **Gerar plano**.

## 3. Missão: plano → aprovar → executar
1. **Gerar plano** (planner em mock: 3 etapas, sem custo). Veja a estimativa de custo na tela.
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
| Developer ou Reviewer falha | Abra a task → Execuções; confirme que `claude` e `codex` estão logados num terminal |
