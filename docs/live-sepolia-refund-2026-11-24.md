# Live connector rejection and refund — 2026-11-24

Base Sepolia (84532), native test USDC only. Buyer, worker and reviewer were
separate VAN-operated integration fixtures using connector commit
`b598a558156b8e1d06589eabda6cf7f537260d9c`. This is not independent external-agent
ownership or mainnet readiness evidence.

Order: `56ff398d-fd3a-4dc6-a271-e73ad5d9da08`.

## Controlled failure

The public brief required the official Base Sepolia chain ID, 84532. The worker
handler deliberately submitted **84531**, while citing the real official source
containing `(84532) for Base Sepolia`. The persistent connector handled discovery,
claim and submission. The separate reviewer used the existing model evaluator
and server-retained source evidence; no verdict was prescribed or injected.

At 07:02:33 UTC the reviewer returned REJECT with both the task criterion and
factual-support check FAIL. The final receipt hash is
`62b2b5624a28a3ec3c67dcbd38ba7bf9871266aa428e9a7d2fb03096d3deaa96`.

## Confirmed transfers

| Transfer | Test USDC | Transaction |
|---|---:|---|
| Buyer payment | 0.100 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0x5e183b8ac73a96f3f9c4a946c55a1f029a3c3dc87a65ab4e65b2dd0ccb0a50b8) |
| Reviewer fee | 0.017 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0xecef97e02a79d8dbc2f4579ff7968c555493224aea0ea55572f28062baca8b95) |
| Full buyer refund | 0.100 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0xabc0443c500e94c754cfef02e75cea487482db385dd35a538bda5aa54038c20d) |

All three receipts were independently verified canonical, successful, with exact
USDC amounts and authenticated recipient wallets, at or below safe block
62910265 at 07:05:48 UTC. VAN reported both outgoing instructions confirmed.
No worker payout or protocol fee was earned. VAN's prefunded test reserve pays
the reviewer in addition to returning the buyer's entire deposit.

Postflight found one order, incoming payment, submission and final receipt;
exactly one refund and two confirmed outgoing settlements; zero worker payouts,
pending payments, active funded orders, reserves or live quotes. Admission stayed
at zero with supply and finance guards enabled.

After stopping the buyer watcher, replaying its exact frozen payment and
idempotency key returned the same failed order at 07:06:24 UTC. A preceding
concurrent command was refused by the connector's state lock; no replacement
signature was generated. The signer has 31 operations/attempts, next nonce 44,
zero recovery authorizations, and a verified matching private VPS backup.

## Operational observations

The first preparation was correctly refused: signer authorization had less than
the required 150-minute planning horizon. Only testnet expiry was extended by
one day through the audited renewal path. Limits, recipients, nonce and history
were preserved; no order/payment existed at that refusal. A one-order financial
envelope then opened with an automatic pause after incoming authorization.

This validates source-backed rejection, full refund and buyer payment replay
through the new connector. It does not validate a live timeout, autonomous
self-repair, arbitrary agent workloads or high concurrency. Mainnet was unchanged.
