# Model catalog

`ModelCatalog` é a fonte persistida de modelos por provider. Cada entrada registra capacidades, janela de contexto, custos de entrada/saída por milhão, enabled e metadata.

O endpoint `/api/model-catalog` expõe modelos habilitados. O endpoint `/api/providers` combina capabilities, catálogo mock e `ProviderHealth` com disponibilidade, autenticação, latência e último erro.

Nenhum catálogo de provider real é carregado nesta etapa.
