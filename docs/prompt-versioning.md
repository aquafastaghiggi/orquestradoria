# Prompt versioning

`PromptTemplate` possui id, nome, versão, template, descrição, data e active. Toda execution registra `promptTemplateId`, `promptTemplateVersion` e `renderedPromptHash`.

O hash permite provar qual prompt renderizado foi usado sem depender apenas do texto de log. O snapshot da task continua sendo a referência histórica da configuração.
