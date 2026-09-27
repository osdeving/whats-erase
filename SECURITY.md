# Política de segurança

## Versões suportadas

O projeto ainda está em fase inicial. Correções de segurança são aplicadas somente à versão mais recente da branch `main`.

## Como reportar uma vulnerabilidade

Use o [formulário privado de vulnerabilidade do GitHub](https://github.com/osdeving/whats-erase/security/advisories/new). Não abra uma issue pública com detalhes exploráveis.

Inclua, quando possível:

- componente e versão afetados;
- impacto observado;
- passos mínimos para reprodução;
- mitigação sugerida;
- confirmação de que os dados usados no relato são fictícios ou foram removidos.

Nunca envie API keys, cookies, QR Codes, senhas, `.env`, JIDs, IDs reais de mensagens, conteúdo de conversas ou dumps dos volumes. Se um segredo aparecer acidentalmente, revogue-o antes de continuar o relato.

Não há SLA formal, mas o recebimento e a gravidade serão avaliados assim que possível. Aguarde uma correção antes de divulgar publicamente uma falha confirmada.

## Escopo relevante

São especialmente importantes falhas que permitam:

- contornar a autenticação do painel;
- recuperar ou adulterar credenciais cifradas;
- forjar webhooks ou acessar dados de outra instalação;
- executar exclusões fora das regras configuradas;
- expor QR Code, cookies, JIDs ou conteúdo de mensagens em logs;
- alcançar serviços além das interfaces publicadas em loopback.

Problemas ou bloqueios causados pelo WhatsApp, Evolution API ou Baileys devem ser reportados aos respectivos projetos quando não decorrerem do código do WhatsErase.
