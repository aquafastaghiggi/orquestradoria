# Provider auth and usage visibility

Claude Code e Codex CLI reportam apenas estados seguros (`api_key`, `account_session_or_cli_managed` e `unknown`); valores de tokens e segredos nunca são exibidos pelo doctor ou pela API de saúde.

Execuções locais e CLI-managed não têm preço confiável. A agregação de uso mantém tokens e marca o custo como desconhecido; a apresentação deve usar `N/A`, nunca `$0.00` como se fosse um custo real.
