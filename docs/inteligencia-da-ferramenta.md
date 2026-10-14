# Como a ferramenta fica mais inteligente (resumo)

Tudo isto veio de revisar as execuções reais do usuário (14/10/2026). Cada item tem teste automatizado; nada aqui chama Claude/Codex
nos testes.

## 1. Para de insistir e pergunta (`packages/core/src/fix-cycle.ts`)
- **Developer bloqueado ou com perguntas** (`status: BLOCKED` ou `questions`): a task para na hora, **sem gastar Tester nem Reviewer**.
- **Rodada de correção sem progresso** (o Developer declara que não alterou nem executou nada): para.
- **Mesmo problema do Reviewer duas rodadas seguidas**: para (outra tentativa igual só gasta crédito).
- A task fica em "Revisão manual" com um cartão que explica o motivo, lista as perguntas e os comandos recusados; **"Responder e
  continuar"** preenche o campo de ajuste. Em missões, a resposta segue junto ao **Retomar**.
- Aprovação invalidada (Developer bloqueado, Reviewer aprovou mesmo assim) também vira cartão explicado, não só "failed".
- Dados: tabela `task_attention`. Para demonstrar sem gastar: coloque `[[mock:bloqueado]]` na descrição de uma task com Developer mock.

## 2. Comandos recusados deixam de bloquear o Developer
- Evidência real: em cada ciclo 1 comando composto era recusado e o Developer concluía "o Bash está bloqueado".
- Agora: comandos de leitura simples liberados (`cat ls head tail grep wc pwd which echo`, `git show/grep`), **não** `env/printenv`.
- O Developer é instruído a rodar **um comando simples por chamada** e a não concluir que o Bash está indisponível.
- As chamadas recusadas (`permission_denials`) são gravadas no resultado, mostradas no cartão e devolvidas ao Developer no ciclo seguinte.

## 3. Reviewer não aprova entrega vazia
Regra de evidência no prompt: rodada vazia, Developer bloqueado ou verificações todas ignoradas = `NEEDS_FIX`.

## 4. Tasks encadeadas
- "Nova task" dentro de uma task oferece **continuar a partir do trabalho dela** (padrão ligado). O trabalho da base é commitado antes
  (não muda o diff nem o Apply dela). Aplicar a nova **leva a base junto** e a marca como aplicada. A base não pode ser descartada
  enquanto houver dependente.
- No formulário geral, aviso de **N tasks aprovadas e não aplicadas** que uma task nova não enxerga.

## 5. Memória do projeto (por workspace)
Cartão "Memória do projeto": texto editável (6000 caracteres) + seção "Aprendido automaticamente" (fatos que o Developer marca com
`KNOWLEDGE: ...` e comandos simples que passaram). Entra no prompt do **Developer e do Reviewer** (máx. 4000 caracteres).

## 6. Tester reexecuta as verificações (`packages/adapters/src/verification.ts`)
Scripts simples (`php|node` em `database/ scripts/ tests/ bin/`) que o Developer relatou como bem-sucedidos são **reexecutados**
com o banco de teste da task. Falhou na reexecução = Tester `FAILED` com a saída real, que volta ao Developer. Ignorados, com motivo
nas notas: comandos compostos, scripts fora dessas pastas, os que precisam de URL/servidor, e os que usam banco sem banco de teste.
Desligar: `TESTER_REEXECUTE_VERIFICATION=0`.

## 7. Pequenos
Título cortado em limite de palavra e texto da solicitação sem triplicar; "Voltar ao workspace" não abre mais tela em branco quando a
task foi aberta pelo Dashboard; preview captura erros do PHP e vira correção com um clique; banco de teste isolado por task.