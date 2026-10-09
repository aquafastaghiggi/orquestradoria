# Live Preview 5.3.2 — validação PHP + Vite

Branch: `feat/live-preview-5-3-2`

## Implementação

- PHP é detectado por `index.php`, usando PHP do `PATH` ou `C:\xampp\php\php.exe` no Windows.
- O servidor PHP embutido usa apenas o worktree isolado, `127.0.0.1` e porta dinâmica.
- Vite é detectado por `package.json` com script `dev` contendo Vite.
- O gerenciador é selecionado pelo lockfile (`pnpm`, `yarn` ou `npm`), com `--strictPort` para impedir fallback silencioso.
- `.cmd` continua sendo executado por `cmd.exe /d /c call`, sem `shell:true`.
- Dependências ausentes não acionam instalação automática; o diagnóstico informa o gerenciador ausente.
- Cada task possui uma sessão ativa; Stop libera a sessão e permite reinício.
- Processos dinâmicos recebem somente variáveis de ambiente de runtime, sem segredos arbitrários.
- A UI mostra runtime, estado, porta, URL, erro e confirmação explícita sobre acesso potencial a APIs/bancos antes de PHP/Vite.

## Testes executados

- Fixture Static: HTTP 200, conteúdo correto, Stop/Restart e arquivo original preservado.
- Fixture PHP real: PHP 8.x/XAMPP, HTTP 200, conteúdo PHP renderizado, encerramento e arquivo preservado.
- Fixture Vite real: `pnpm run dev`, HTTP 200, `--strictPort`, encerramento correto.
- Sessão duplicada: mesmo id reutiliza a sessão ativa; após Stop o mesmo id pode reiniciar.
- Windows `.cmd`: invocação validada via `cmd.exe`, sem shell mode.
- Browser QA: testes existentes continuam passando e não compartilham a sessão do Preview.

Validação final registrada após implementação:

- `pnpm build`: aprovado.
- `pnpm typecheck`: aprovado.
- `pnpm test`: 239/239 aprovados, 0 falhas.
- `git diff --check`: aprovado após a revisão final.

## Limitações e riscos

- O servidor PHP embutido não reproduz recursos exclusivos do Apache, como regras de rewrite e módulos/configurações do XAMPP. Isso deve ser tratado como limitação, não como compatibilidade completa.
- Preview dinâmico pode acessar serviços externos configurados pelo projeto. A UI exige confirmação e não copia `.env`, inicia serviços, executa migrações, seeds, deploy, push ou comandos arbitrários.
- O Preview usa o worktree da task; Apply/Discard e o pipeline continuam responsáveis pelo isolamento Git.

## Homologação manual no Windows 11

1. Criar uma task com worktree isolado contendo `index.php` ou um projeto Vite com dependências já instaladas.
2. Abrir a Task Detail e conferir o runtime detectado, a confirmação de risco e a porta dinâmica.
3. Iniciar, abrir a URL local, verificar o conteúdo e parar o Preview.
4. Reiniciar e confirmar nova disponibilidade.
5. Executar ou retomar a task e confirmar que o Preview é encerrado antes do pipeline.
6. Confirmar que a branch principal e a pasta original não foram alteradas.
