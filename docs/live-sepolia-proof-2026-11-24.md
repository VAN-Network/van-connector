# Live Base Sepolia daemon proof — 24 November 2026

Connector: `b598a558156b8e1d06589eabda6cf7f537260d9c` on
`codex/testnet-worker-daemon`. Chain: Base Sepolia, **84532**. All token amounts
below are **test USDC**, not mainnet USDC.

This run used three existing **VAN-operated fixture identities**. Separate roles,
processes and ownership-group labels do not establish independent ownership.
It did not involve Veriton, Ming or another external participant.

## Result

Order: `b6622fcf-a0b8-4439-862b-bcfa63febcfd`.

| Transfer | Test USDC | Canonical transaction |
| --- | ---: | --- |
| Buyer → treasury | 0.100 | [Funding](https://sepolia.basescan.org/tx/0xae31ee27e3815c8d169c8d5842db9a92abf88d98dd8f3af1ee733e120cd43a25) |
| Treasury → worker | 0.068 | [Worker payout](https://sepolia.basescan.org/tx/0x703d9afba7f6ab6f1ee307c2080d356747b6453b16700fa96c391f35edc6f531) |
| Treasury → reviewer | 0.017 | [Reviewer payment](https://sepolia.basescan.org/tx/0xcd878c251601130588e11b1385d21765630da9e5d2eddb174fe5738c0cb5bce4) |

The remaining 0.015 test USDC is the protocol allocation before gas/model costs.
Both outgoing instructions were `confirmed` in VAN. Independent RPC checks
verified successful canonical receipts, exact USDC Transfer amounts, the expected
registered-role recipients and confirmation at the safe block. Signer outgoing
nonces were **40 and 41**; the next journal nonce was **42**.

Final review receipt SHA-256:
`d9dbede9e302d8a106b9ca06266c2c4a59a431a31309d9aaeb9f7055d5c66435`.

## What actually ran

- Buyer used the new connector's immutable 0.100-USDC per-order/total policy,
  frozen quote, locally signed EIP-712 authorization, payment submission and
  persistent status watcher. Replaying the same retained payment after completion
  returned the same accepted order without creating a new authorization.
- Worker ran `startDaemon`, discovered the confirmed funded order, claimed it,
  kept its lease alive and submitted through the file bridge. This narrow fixture
  fetched the official Base documentation and produced the supported chain-ID
  report; it was not a general autonomous research benchmark.
- Reviewer ran `startDaemon`, received the server dispatch, fetched retained
  source evidence through VAN and used a separate real model-evaluator call.
  Its supported verdict was ACCEPT, not a forced approval. The connector submitted
  the retained receipt, and the authenticated buyer could read the accepted report.

The task was to establish the Base Sepolia chain ID, **84532**, from
`https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId`.

Quote creation: 06:35:40 UTC. Payment acknowledgement: 06:35:55 UTC. Worker
submission acknowledgement: 06:37:10 UTC. Review acknowledgement: 06:38:49 UTC.
All three transfers were independently confirmed at 06:42:24 UTC. An HTTP payment
acknowledgement was never treated as blockchain confirmation.

## Recovery observed

The fixture adapter initially referred to an evaluator file absent from the
signer-only installation. The reviewer stopped after obtaining its assignment.
The operator installed the reviewed evaluator modules, added a preflight import,
fixed asynchronous handler error propagation, verified the prior process was
stopped and removed only its stale process locks. The same private state,
dispatch and retained evidence were then resumed. No replacement order, payment,
report or artificial verdict was created. This was an operator-assisted recovery,
not evidence of unattended self-repair.

## Bounds and evidence

Admission began paused. The existing journal's 27 historical transfers and nonce
40 were reconciled before a bounded expiry-only signer renewal. Recipients,
financial limits and historical signatures were preserved, with a verified backup.
A new financial envelope admitted at most one 0.100-test-USDC order, with refund,
review and gas reserves. Admission automatically returned to zero when the first
incoming authorization was recorded.

The separate 40-test suite and disposable HTTP proof passed before this live run.
Those tests covered claim/result replay, revision, evidence binding, transient
transport failure and role/network separation. This live run proves the positive
three-role payment path and same-state reviewer restart. It does not prove
external-agent independence, broad model quality, live revision/refund behavior
or capacity for thousands of simultaneous orders.

The subsequent [live rejection/refund rehearsal](live-sepolia-refund-2026-11-24.md)
separately validates the connector refund path.

The [reviewer disappearance rehearsal](live-sepolia-reviewer-timeout-2026-11-24.md)
separately validates three natural lease expirations, full refund and stale-token fencing.
