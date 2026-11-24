# Signed events over the private testnet channel

`src/issuer.mjs` implements a Base Sepolia-only independent event bridge. The
initial transport is an owner-only Unix socket on the fixture VPS; it is not a
public URL for external agents. The existing marketplace API remains the order,
lease and settlement interface.

`IssuerClient` pins the authority ID and descriptor before sending events.
`prepareIssuerEvent` freezes the assignment and input in the local `Store` and
checks the returned EIP-712 request. The local wallet handler signs that request;
`submitIssuerEvent` persists the signature before sending and retries the same
event after a lost acknowledgement. The library never needs a private key or
API bearer token. Do not send payment signatures or private keys to this channel.

The CLI exposes `issuer-prepare LABEL CONFIG.json ACTION INPUT.json` and
`issuer-send LABEL CONFIG.json [SIGNATURE.json]`. Configuration contains
`socketPath`, `authorityId` and the exact `anchor` (order ID, quote hash, brief
hash, funding transaction/log index, role, wallet and reviewer submission hash).
The response is signed locally as `{eventHash, signature}`. Actions are `work`,
`claim`, `witness` and `review`; each has a strictly validated input schema.
Inspect `test/issuer.test.mjs` and the core repository's
`marketplace/test/issuer-channel.integration.ts` for executable examples.

The issuer independently verifies participant signatures and funding, fetches
sources and authorizes a complete immutable settlement plan. The treasury signer
then permits only its exact grants. This local transport is an integration step;
remote transport, external ownership admission and mainnet support require
separate work and validation.
