# Gateway v3.4.1 — candidato para revisão

Base Melly: `4f1368960915dd57518fb514401d0f684e838c32`.
Base Claw3D: `0565b7892909eca7bbc8f2d9b0fad171dd75ad7c`.

## Alteração

- `patch-ops-v3.4.1.js`: insere um caminho antecipado em `forwardConnectFrame`.
  Para OpenClaw com `SOFIA_GATEWAY_PRESERVE_DEVICE_AUTH=1`, exige os campos
  de identidade completos e uma credencial do navegador. Encaminha o frame
  inteiro sem alterar token, device, client, scopes, timestamp ou nonce.
  Caso incompleto: erro explícito de pareamento, sem injetar token do servidor.
- `apply-chain.sh`: adiciona v3.4.1 opcional. Padrão continua v3.4.
- `tests/gateway-v3.4.1.test.cjs`: testa o proxy real com WebSockets locais.

Não concede escopos nem verifica assinaturas no proxy. O Gateway continua
responsável pela verificação criptográfica e pelas permissões do dispositivo.
Sem credencial pareada existente, é necessário o fluxo de pareamento suportado.

## Teste local

Execute com um checkout limpo do Claw3D no commit acima e a dependência `ws`
disponível nesse checkout:

```sh
node claw3d/tests/gateway-v3.4.1.test.cjs /caminho/Claw3D
sh -n claw3d/apply-chain.sh
node --check claw3d/patch-ops-v3.4.1.js
git diff --check
```

Cobertura: frame intacto, assinatura Ed25519 local ainda válida, nonce intacto,
cinco casos incompletos recusados, equivalência com v3.4 sem flag, outro adapter
inalterado, limites da cadeia por seleção explícita e recusa de patch duplicado.
A cadeia completa, assets e build Next não são executados por esse teste: somente
as seções de proxy dos patches reais v3.3/v3.4 e o overlay v3.4.1.

## Antes de aplicar no staging

Ainda não houve deploy nem validação no Android/Gateway real. Uma futura aplicação
precisa selecionar o estágio v3.4.1 no build e ativar a flag somente no staging.
Dockerfile e seu estágio padrão continuam v3.4. O proxy de login `server-v2.js`
não é alterado. Canary preserva a origem do navegador; para reutilizar o token
pareado, a URL configurada do Gateway (`authScopeKey`) também precisa ser a mesma.
As configurações reais desses serviços ainda precisam ser conferidas.
