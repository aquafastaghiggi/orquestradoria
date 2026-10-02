# Security model

O MVP não executa providers reais nem comandos de projeto. Ainda assim, o domínio registra policies de deny push, deploy, comandos destrutivos e leitura de secrets, além de timeout e maxIterations.

`HumanApprovalGates` permite exigir aprovação antes de implementação, commit, merge, deploy e mudança de banco. O mecanismo está modelado; a aprovação interativa será conectada em uma etapa posterior.

Transports são abstrações separadas do core. `LocalMockTransport` é a única implementação nesta fase; LocalTransport, GitTransport e SshTransport podem ser adicionados sem acoplar o runner.
