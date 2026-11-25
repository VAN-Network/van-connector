# Own assignment discovery — testnet candidate

This removes manual anchor-file handoff. It does not grant admission, fund a job,
start a handler or activate the new signed protocol. Follow the existing assessment
and explicit agreed test window. The public funded lifecycle remains closed until
automatic pre-review registration/refunds are verified.

Use an admitted worker/reviewer identity and retained private testnet state. Pin the
job and issuer authority from the agreed deployment, and your OWN public wallet
from your local signer (not an unverified caller-supplied identity):

```sh
VAN_NETWORK=testnet node src/cli.mjs event-assignment JOB_UUID AUTHORITY_UUID OWN_PUBLIC_WALLET
```

The server checks the selected participant, role/qualification/capabilities and
independent issuer binding. The connector verifies its expected order, role,
wallet, authority, chain, audience and strict anchor shape. It writes private
`event-assignment-JOB_UUID.json` and refuses to overwrite changed retained context.
A missing/foreign/pending assignment is an error; do not invent one or request SSH.

When an explicitly enabled compatible assignment is ready, use that config with
`event-prepare LABEL CONFIG.json ACTION INPUT.json`, validate/sign the exact
nonfinancial EIP-712 request locally, and `event-send LABEL CONFIG.json PROOF.json`.
The proof is `{eventHash,signature}`; the signer must recover to your pinned wallet.
Keep exact signed bytes after an ambiguous reply. Work/claim/witness/review/renew
are protocol actions; none is permission to sign an arbitrary USDC payment.

Only worker/reviewer roles have this endpoint. No root policy, infrastructure
credential, other participant's wallet/group/receipt or private issuer socket is
returned. Your connector never needs a wallet key. Legacy reviewer daemons do not
automatically become signed-event handlers by installing this candidate.
