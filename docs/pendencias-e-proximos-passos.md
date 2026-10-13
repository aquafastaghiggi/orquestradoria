# Pendências e próximos passos (salvo em 2026-10-13, fim do dia)

Estado do código: tudo commitado e enviado (último commit funcional `e56857d`; testes 288/289, o 1 que falha é o teste instável conhecido `GET /api/providers normalizes persisted stale authentication`, que passa isolado).

## Onde paramos (teste real do usuário, projeto `teste-processo2`)

- Missão de 1 etapa funcionou: Haiku 5.5 + Codex Luna, **US$ 0,03**, 1 min 50 s, 3 arquivos. Preview OK.
- **Ajuste 1 ("título verde + botão Limpar concluídas") FALHOU** e a missão ficou em "Preciso de você":
  1. Developer fez a alteração (título verde e botão existem), Tester passou.
  2. Reviewer (Codex) deu `NEEDS_FIX` apontando texto com codificação quebrada ("vocÃª", "concluÃ­das").
  3. O Developer da rodada de correção automática trabalhou (5,2 mil tokens de saída) mas a resposta final **não veio como JSON válido** → `Claude structured output is not valid JSON` → etapa `failed`, ambiente preservado.
- **Estado atual do arquivo** no worktree (`apps/api/storage/worktrees/oBSmuZm2DdjP8vcWSmjdk/mission-s7ucrKAdLk3Mzrp6B49aH/index.html`): UTF-8 válido, sem BOM, `charset="UTF-8"`, acentos corretos ("você", "Limpar concluídas"). O trabalho está bom; falta só destravar a missão (RETOMAR MISSÃO ou descartar o ajuste) e aplicar.

## Investigação de codificação (inconclusiva, não gastar mais antes de decidir)

| Hipótese | Teste | Resultado |
|---|---|---|
| Codex lê UTF-8 como mojibake no Windows | Codex lendo um `index.html` UTF-8 com acentos, sem instrução especial (~US$ 0,004) | **Descartada**: leu certo |
| Claude CLI decodifica o prompt do stdin como Windows-1252 | `claude -p` via stdin com "concluídas — você — ação" (~US$ 0,01) | **Descartada**: devolveu o texto certo |
| O 1º Developer escreveu mojibake e o auto-fix corrigiu | Reviewer viu "concluÃ­das" (padrão exato de UTF-8 lido como CP1252); arquivo hoje está correto | **Plausível, causa não achada** (pode ser o pacote de revisão, o diff sintético de arquivos novos, ou o próprio modelo) |

Próximo passo sugerido (grátis): reproduzir só a geração do pacote de revisão (`createReviewBundle`) e o diff de arquivos não rastreados sobre um arquivo com acentos, e inspecionar os bytes que o Reviewer recebe (`apps/api/src/review-bundle.ts`, `packages/workspace/src/index.ts`, função de diff de untracked).

## Melhorias propostas (nada disto foi implementado)

1. **Saída estruturada do Developer mais resiliente.** Hoje qualquer saída que não seja JSON válido derruba a etapa mesmo com as alterações feitas. Opções: (a) se houver alterações no workspace, degradar para um resultado `COMPLETED` sintetizado a partir do diff, com aviso, deixando Tester/Reviewer validarem; (b) usar `claude --json-schema` (a flag existe na versão 2.1.287) para forçar a saída estruturada.
2. **Aviso quando o Auto-Fix falha só pelo formato** (não por falta de trabalho), com botão "aceitar alterações atuais e seguir para o Reviewer".
3. Botão **"Desfazer aplicação"** e recuperação de tasks interrompidas por reinício da API (ainda não verificado).
4. **Teste de fumaça automatizado da interface** + CI.
5. Retenção automática de logs/eventos antigos.
6. Usar a **API direta da Anthropic** no Refinador e no Planner de missão (~30x mais barato que via Claude Code).

## Custos observados hoje (conta real)

| Item | Custo |
|---|---|
| 1ª missão (Developer em **Sonnet 5.5** por config global não trocada) | US$ 0,30 |
| Missão `teste-processo2` (Haiku 5.5) + ajuste parcial | ≈ US$ 0,03 + ≈ US$ 0,02 + tentativa de correção (≈ US$ 0,01–0,02) |
| Ensaio geral + calibração + sondas de diagnóstico (minhas) | ≈ US$ 0,10 + ≈ US$ 0,02 |

Lembrete: o valor de custo que o Claude CLI informa é inflado (~30x) para o Haiku 5.5; o orquestrador calcula pela tabela de preços.

## Para retomar amanhã

1. Abrir `iniciar-real.cmd` (SIM) e conferir a faixa do topo: **Developer: Claude Haiku 5.5**, sem "⚠ caro".
2. Decidir sobre a missão `teste-processo2`: **RETOMAR MISSÃO** (custa centavos) ou **DESCARTAR MISSÃO** e recomeçar.
3. Escolher a primeira melhoria (recomendo a nº 1: saída estruturada resiliente) e fechar a investigação de codificação.
