# Command Tester

O `command-tester` é um provider local, restrito ao estágio `tester`. Ele detecta somente comandos estruturados a partir de arquivos do projeto e scripts existentes; não interpreta a descrição da tarefa como shell e nunca usa `shell: true`.

Ative-o no snapshot de novas tarefas com `TESTER_PROVIDER=command-tester`. O detector suporta scripts `typecheck`, `test` e `build` de projetos Node (`pnpm`, `npm` ou `yarn`, conforme lockfile), lint explícito de arquivos PHP atribuídos e perfil informativo para Python. Sem comandos seguros detectados, o resultado é `BLOCKED`.

`TEST_COMMAND_TIMEOUT_MS`, `TEST_MAX_OUTPUT_CHARS`, `TEST_FAIL_FAST` e `TESTER_REQUIRED` controlam timeout, truncamento, fail-fast e se um tester bloqueado deve impedir a conclusão.

O doctor só inspeciona binários e configuração; não executa os comandos detectados e não envia prompts a Claude ou Codex.
