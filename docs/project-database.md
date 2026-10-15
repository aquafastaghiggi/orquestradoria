# Banco MySQL de teste dos projetos

As tasks do Developer podem **rodar de verdade** o que escrevem (scripts PHP de criação de banco, seed, verificação) contra um
banco MySQL descartável, ler o erro real e corrigir antes de terminar. Sem isso o Developer só escrevia o script e o Reviewer
apontava "não foi executado".

## Como funciona

- Um login próprio, `orquestradoria`, com acesso **somente a bancos `orq_*`**. Ele não vê nem altera o banco real de nenhum projeto
  (não cria outros bancos, não lê `mysql.*`; validado contra um MySQL real).
- Cada task (ou missão, para todas as suas etapas) recebe um banco `orq_<id>`, criado sob demanda e reaproveitado ao retomar.
- O Developer recebe as variáveis `ORQ_DB_HOST`, `ORQ_DB_PORT`, `ORQ_DB_USER`, `ORQ_DB_PASSWORD`, `ORQ_DB_NAME` e o prompt manda:
  ler essas variáveis no código do projeto, **executar** os scripts, corrigir falhas e listar os comandos rodados e seus resultados reais.
- O Developer pode executar `php` (além de `node`, `pnpm test/build/typecheck`). Continua proibido de commitar, dar push, apagar arquivos.
- Os bancos `orq_*` que não pertencem mais a nenhuma task/missão com ambiente ativo são apagados automaticamente (na subida da API e
  a cada 10 minutos) ou pelo botão "Limpar bancos de teste sobrando" em Configurações.

## Configurar (uma vez)

1. Ligue o MySQL no painel do XAMPP.
2. No terminal, na pasta do Orquestradoria: `pnpm db:setup`. Ele pede a senha do `root` (digitação oculta; Enter se não houver),
   cria o login com uma senha aleatória e guarda tudo em `apps/api/storage/project-database.json` (fora do Git). A senha do root
   **não é gravada**.
3. Conferir ou trocar depois: **Configurações > Banco MySQL dos projetos** (host, porta, usuário, senha, caminho do `mysql.exe`,
   botão "Testar conexão"). A senha nunca é devolvida pela API: deixar o campo vazio mantém a atual.

Sem esse login configurado nada muda: as tasks seguem como antes, só que o Developer não terá banco para testar.

## Limites conhecidos

- O banco é de **teste**. Criar o banco real do projeto continua sendo um passo do usuário (por exemplo, rodando o script de setup
  que a task entregou, com o MySQL real).
- O projeto gerado precisa ler `ORQ_DB_*`; o prompt pede isso, mas o Reviewer deve conferir.
- A senha do login fica em arquivo local sem criptografia (acesso apenas a bancos de teste, na sua máquina).

## Limpeza segura (registro por instância)

A limpeza só apaga bancos que **esta instância registrou** (tabela `project_databases` do SQLite). Um banco `orq_*` criado por outra
instância (teste de fumaça, segundo clone) nunca é tocado, e o teste de fumaça roda com o banco de teste desligado
(`ORQ_PROJECT_DB_DISABLED=1`). Isso corrige um erro real: antes a limpeza apagava qualquer `orq_*` que não conhecesse, e um teste
de fumaça apagou o banco de uma task.

## Erros do preview viram correção

O servidor PHP do preview loga erros no `stderr` (`PHP Fatal error`, `Warning`, respostas 4xx/5xx). O cartão **Preview e ajustes**
lista as últimas ocorrências (atualiza a cada 4 s) e oferece **"Criar correção a partir destes erros"**: preenche o campo de
ajuste, que você complementa e envia ao Developer. O preview recebe as variáveis `ORQ_DB_*` do mesmo banco de teste da task.

## Verificação prévia ao Developer

Antes de iniciar o Developer, a API faz **uma única** verificação (`SELECT 1` + criar o banco `orq_*` da task). O resultado vai para a
auditoria (`project_database.preflight` ou `project_database.unavailable`, só com sucesso/erro amigável, nunca credenciais).

- **Disponível:** o prompt informa que a conexão já foi verificada e manda ler `ORQ_DB_*` direto no PHP (`getenv`) ou Node
  (`process.env`), sem `printenv`, `env`, `set` ou `echo` das variáveis (continuam recusados pela política).
- **Indisponível:** o prompt traz o diagnóstico, proíbe procurar credenciais e insistir, e manda registrar as verificações que dependem
  do banco como `skipped` ("test database unavailable"). Nada é repetido e nenhum banco real é tocado.
- **Tester:** as notas distinguem `Verificação reexecutada com sucesso`, `A verificação reexecutada falhou` e
  `Verificação não reexecutada (motivo)`. Verificações que precisam de servidor HTTP em execução continuam não reexecutadas pelo Tester.
