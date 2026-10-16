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
