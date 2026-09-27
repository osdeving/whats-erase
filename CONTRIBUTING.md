# Como contribuir

Obrigado pelo interesse no WhatsErase. Mudanças pequenas, verificáveis e sem dados reais são as mais fáceis de revisar.

## Ambiente local

Requisitos para desenvolvimento:

- Node.js 22+;
- npm;
- Docker com Compose v2 para o fluxo integrado.

```bash
npm install
npm run check
```

Para executar a pilha completa:

```bash
./scripts/setup.sh
docker compose up -d --build
```

## Fluxo de contribuição

1. Crie uma branch curta a partir de `main`.
2. Faça uma mudança focada.
3. Adicione ou atualize testes quando o comportamento mudar.
4. Execute `npm run check`.
5. Revise o diff procurando credenciais e dados pessoais.
6. Abra o pull request explicando problema, solução, riscos e validação.

## Regras de segurança e privacidade

- Use somente JIDs, IDs e payloads claramente fictícios em testes e screenshots.
- Nunca versione `.env`, QR Codes, cookies, logs reais, dumps ou volumes Docker.
- Não inclua texto ou mídia de conversas em fixtures.
- Não teste exclusões reais em contas ou mensagens de terceiros.
- Preserve o modo simulação como caminho seguro para validação manual.
- Alterações de contrato, webhook, autenticação ou persistência precisam de teste e documentação.

Para vulnerabilidades, siga [SECURITY.md](SECURITY.md) em vez de abrir uma issue pública.
