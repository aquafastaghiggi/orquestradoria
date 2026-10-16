# Inteligência de fluxo funcional

O Orquestradoria passa a entender, implementar e **validar fluxos completos** (por exemplo login → upload → gravação no MySQL →
listagem na conferência) sem que o pedido liste cada arquivo.

## 1. Mapa do projeto e plano (antes do Developer)

`analyzeProjectFlows` (packages/adapters/src/flow-intelligence.ts) lê as páginas PHP/HTML do worktree da task e identifica:
páginas e endpoints, formulários (método, campos, `multipart`/campos de arquivo), autenticação (página que verifica senha e grava
`$_SESSION`; páginas protegidas por sessão), tabelas lidas e gravadas por cada página, redirecionamentos e uso de `ORQ_DB_*`.

Daí sai um **plano** com fluxos, etapas e critérios de aceite (`FLOW1…`):

- **fact**: confirmado no código (com o arquivo de origem). **hypothesis**: inferência ou peça que ainda não existe.
- Um fluxo é **obrigatório** quando o pedido o descreve como fluxo (2 ou mais tópicos: login, upload, listagem/conferência) ou
  quando o código já tem a peça mencionada. Menção solta ("trocar o texto do botão") não exige validação de ponta a ponta.
- **Ambiguidades** relevantes (duas páginas de login, dois pontos de upload, mais de uma listagem) aparecem no plano; o Developer
  só pergunta (status `BLOCKED` + `questions`) quando a ambiguidade muda o que deve construir.

O mesmo plano vai para o **Developer** (com as regras de reaproveitamento), o **Tester** (recalcula o plano no estado atual do
código) e o **Reviewer** (regra: não aprovar fluxo obrigatório ausente, falho ou não validado). Evento: `flow_plan.generated`.

## 2. Testes de ponta a ponta (PHP + HTTP local + MySQL ORQ_DB_*)

O Developer declara `functionalFlows` no JSON final; o **Tester os executa** (packages/adapters/src/functional-flow.ts):

| Etapa | O que faz |
|-------|-----------|
| `php` | roda um script de `database/`, `scripts/`, `tests/` ou `bin/` com `ORQ_DB_*` (seed temporário) |
| `http` | `GET`/`POST` (formulário ou multipart com arquivo gerado) no servidor `php -S 127.0.0.1:<porta livre>`; cookies mantidos entre etapas; confere status, redirecionamento, texto presente/ausente e erros PHP |
| `db` | um único `SELECT` no banco de teste (via PDO, com `ORQ_DB_*`) |
| `cleanup` | `DELETE FROM`, `TRUNCATE TABLE` ou `DROP TABLE IF EXISTS` no banco de teste |

Restrições: só o servidor local; o banco precisa chamar-se `orq_*` e o usuário não pode ser `root`; sem rede externa; credenciais
mascaradas na evidência. Arquivos que os fluxos criarem no workspace (uploads de teste) são removidos ao final, mesmo após falha.

## 3. Evidência e aprovação

`functionalFlows` no resultado do Tester traz, **por etapa**, status (`passed`/`failed`/`skipped`/`blocked`) e evidência real
(por exemplo `POST /login.php → 302 Location: upload.php · cookies na sessão: PHPSESSID`).

- Etapa falhou → Tester `FAILED` (ciclo de correção recebe a etapa, a evidência e os arquivos prováveis, "editar no lugar, não recriar").
- Fluxo obrigatório sem teste, ou impossível de executar (PHP ou banco de teste indisponível) → Tester `BLOCKED` com
  `blockReason: required_flow_unvalidated`. O pipeline para **antes do Reviewer**, mesmo que o Tester não seja obrigatório.
- A verificação de integridade da aprovação também recusa um `PASSED` cujo relatório funcional tenha fluxo obrigatório não validado.
- A mesma falha do Tester em duas rodadas seguidas interrompe o ciclo automático (`repeated_issue`).
- Verificações impossíveis são registradas como tal (`Verificação impossível: …`), nunca como sucesso.

## Ajustes

- `FLOW_VALIDATION=0` desliga plano e validação funcional; `FLOW_REQUIRED=0` mantém o plano mas não exige nenhum fluxo.
- Só vale quando o Developer é o Claude Code (como a reexecução de verificações do Tester).

## Limitações

- A análise é por padrões (regex) em PHP/HTML; frameworks, rotas dinâmicas e SPAs não são mapeados e viram hipótese.
- Quem **escreve** os passos HTTP/SQL dos fluxos é o Developer; o Tester garante que sejam executados e conferidos, não que cubram
  tudo. Um teste fraco pode passar; o Reviewer recebe o plano e as evidências para julgar isso.
- Login e upload são exercitados apenas contra o servidor local e o banco `orq_*`; nunca contra o banco real do projeto.
- Diretórios criados por um upload de teste permanecem (vazios); só arquivos são removidos.
- Nenhum Claude/Codex real foi executado na validação: ela usa um fixture PHP de motorista e o MySQL do XAMPP.

## Hotfix: cobertura por provas, isolamento do banco e limpeza precisa

**Cobertura por provas.** `flowId` e `covers` não validam nada. Um fluxo obrigatório só é validado pelas provas das etapas
**executadas e aprovadas**, correlacionadas pelo mesmo valor enviado no upload:

| Prova | O que precisa existir |
|-------|-----------------------|
| login | `POST` na página de login do código, com verificação específica (redirecionamento ou texto) e cookie de sessão recebido |
| acesso autenticado | depois do login, requisição com a sessão a uma página protegida, com verificação específica |
| upload | `POST` multipart com arquivo para a página de upload, com verificação específica e, se a página exige sessão, depois do login |
| gravação | depois do upload, `SELECT` numa tabela que o upload grava, citando o arquivo/valor enviado e esperando ao menos 1 registro |
| listagem | depois do upload (e da gravação), `GET` na página que lê essa tabela, esperando o valor enviado na resposta |

O fluxo completo exige todas, em ordem, dentro do mesmo teste. Testes superficiais (`GET /` com HTTP 200), `SELECT COUNT(*)` sem
citar o valor enviado, listagem sem o valor ou upload antes do login deixam o fluxo **não validado** (Tester `BLOCKED`, com a lista
do que falta).

**Isolamento do banco.** Antes de qualquer PHP/HTTP/SQL de um teste, `checkDatabaseIsolation` analisa os arquivos que o teste pode
executar (alvos das etapas + `require/include` encadeados). Bloqueia, informando arquivo e motivo, quando: o banco isolado
(`ORQ_DB_*`, banco `orq_*`, host local, usuário diferente de `root`) não está disponível; o código que conecta (`PDO`, `mysqli`)
não lê `ORQ_DB_HOST/USER/PASSWORD/NAME`; usa o usuário `root`; ou tem um `dbname` fixo que não é `orq_*`. Nada é executado nesses
casos e nunca se cai para credenciais reais. Os processos PHP também não herdam `DB_*`, `MYSQL_*`, `DATABASE_URL` etc. do host.

**Limpeza precisa.** Só são removidos arquivos que uma etapa comprovadamente criou (diferença de arquivos por etapa; arquivos
preexistentes nunca são apagados) e diretórios novos que ficaram vazios. Arquivos preexistentes alterados pelo PHP são preservados
e reportados. No banco, a limpeza aceita apenas `DELETE FROM t WHERE ...` (o `WHERE` precisa citar um valor criado pelo teste) e
`DROP TABLE IF EXISTS` de tabela criada pelo teste; `TRUNCATE` e `DELETE` sem `WHERE` são rejeitados, e registros que já existiam
antes do teste são preservados.

Limitações do hotfix: a análise de isolamento é estática (regex sobre PHP): código que monta a conexão de forma dinâmica fora das
formas reconhecidas, ou lê credenciais de um `.env`/`.ini`, é bloqueado por não ler `ORQ_DB_*`, mas um código que lê `ORQ_DB_*` e
ainda assim conecta a outro lugar por um caminho não analisado não é detectado. Arquivos criados por outro processo durante o
teste seriam confundidos com os do teste.

## Isolamento do PHP (`database-isolation.ts`)

`checkDatabaseIsolation` agora **prova** o isolamento em vez de procurar a palavra `ORQ_DB_*` no código. Só o código PHP (sem HTML
nem comentários) alcançável pelo teste é analisado; o que não puder ser determinado com segurança **bloqueia**, antes de qualquer
PHP/HTTP/SQL.

- **Origem de cada conexão.** Em `new PDO`, `new mysqli`, `mysqli_connect`, `real_connect`, host, usuário, senha e banco são rastreados
  (literais, variáveis, constantes, `define`, interpolação, concatenação, `sprintf`) até leituras de `ORQ_DB_*`. Ler `ORQ_DB_NAME`
  e montar o DSN com `dbname=controle_notas` (direto, por variável, por constante ou por sufixo fixo) é bloqueado; usuário, senha e
  banco precisam vir de `ORQ_DB_USER`, `ORQ_DB_PASSWORD` e `ORQ_DB_NAME`; o host, de `ORQ_DB_HOST` ou ser local. Um valor padrão
  (`getenv('ORQ_DB_NAME') ?: 'x'`) é aceito só quando a origem principal é `ORQ_DB_*` (o ambiente do teste define todas), com nota.
- **Código que pode ocultar a conexão** bloqueia: `include`/`require` dinâmicos, que não resolvem para um arquivo do projeto ou de
  recurso externo; `eval`, `new $classe`, variáveis variáveis, chamadas dinâmicas, autoload dinâmico, `auto_prepend_file`;
  camadas de banco de terceiros (Doctrine, Eloquent, wpdb…); outros motores (pg, oci, sqlsrv, SQLite, Mongo); extensão `mysql_*`
  legada; `USE outro_banco`; e `outro_banco.tabela` em consultas.
- **Includes literais** (`__DIR__ . '/db.php'`, `dirname(__FILE__)`, valores fixos por variável) são seguidos e também analisados.
- O fluxo legítimo (conexão toda derivada de `ORQ_DB_*`) continua liberado.

Limitações: continua sendo análise estática de PHP. Qualquer padrão que ela não reconheça é bloqueado (pode haver falso bloqueio, por
exemplo conexão montada por parâmetro de função ou array de configuração); código dentro de `vendor/` não é lido, então só as
camadas de banco de terceiros conhecidas são detectadas.

Correção junto: o executor agora espera o servidor PHP embutido sair antes de limpar (no Windows ele segurava o diretório e o
teste falhava de forma intermitente com EBUSY).
