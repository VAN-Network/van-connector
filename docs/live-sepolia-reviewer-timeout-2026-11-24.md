# Live connector reviewer disappearance — 2026-11-24

Base Sepolia (84532), native test USDC, VAN-operated buyer/worker/reviewer
fixtures. Connector code: `b598a558156b8e1d06589eabda6cf7f537260d9c`.
Order: `9739bece-d6b9-4025-b3f6-6e70c90aaf19`.

The persistent worker submitted a correct sourced report establishing chain ID
84532. A bounded VPS fault coordinator launched the actual connector reviewer
in isolated per-attempt state directories, without a decision handler, and
stopped each process immediately after its authenticated review claim. Separate
instance/process heartbeats continued; no job heartbeat was sent after each
stop. Deadlines and retry counters were never edited in PostgreSQL. No server,
signer or connector application code was changed for this test.

## Natural timeout sequence (UTC)

| Attempt | Process stopped after claim | Initial lease expiration |
|---|---|---|
| 1 | 07:15:42 | 07:18:40 |
| 2 | 07:18:51 | 07:21:49 |
| 3 | 07:22:00 | 07:24:58 |

The coordinator observed public `closed` at 07:25:09. The server's normal expiry
loop recorded exactly one `review_processing_exhausted` refund event. There was
no accepted verdict, final receipt, intermediate review iteration or reviewer
fee. The database retained three claimed dispatch starts, zero delivery failures
and two replaced processing failures; the third expired current lease completes
the three-failure budget without needing a fourth dispatch.

At 07:19:10, attempt 1's old token returned HTTP 409 for claim and job heartbeat
while attempt 2 was current. After closure, old-token evidence collection and a
late INCONCLUSIVE receipt-shaped probe both returned 409 at 07:26:17. The probe
was refused and created no review receipt or payment. All three expired tokens
also returned 409 for claim and heartbeat after closure.

## Confirmed money and idempotency

| Transfer | Test USDC | Transaction |
|---|---:|---|
| Buyer payment | 0.100 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0xc591b2e1874779b7cceeff2eea35f6b730620e13a41ac528888b634593445c75) |
| Full buyer refund | 0.100 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0xdb88235d44ecda62d2b38f29cde9c5cce2e2fe73576001a8f8364f21b216390e) |

Both receipts were independently checked successful, canonical, with exact native
USDC asset/amount and authenticated recipient, at safe block 62916408 at 07:27:34.
VAN reported the refund confirmed. Worker, reviewer and protocol earnings are
zero. One signed refund used treasury nonce 44.

At 07:27:53, replay of the buyer's same frozen authorization and idempotency key
returned the same failed order. No replacement signature or order was generated.
Postflight requires one incoming payment, one submission, no receipts/iterations,
one refund instruction/confirmed settlement/signed attempt, zero worker/reviewer
payment instructions and exactly one processing-exhaustion event. Pending money,
active funded work, reserves and live quotes are all zero; admission remains zero.

## Operational bounds

All 31 prior signer operations were reconciled before one-order admission.
The one-order envelope retained worst-case refund/review/gas headroom and paused
automatically upon incoming authorization. Existing testnet signer policy and
limits were unchanged during this run. A matching private VPS backup audits 32
operations/attempts, next nonce 45 and zero recovery authorizations. This
same-server backup is not off-host disaster recovery.

This proves natural reviewer processing exhaustion, refund once and stale-token
fencing through the current testnet connector. Stopping/replacing processes was
controlled by the test coordinator: it does not prove autonomous stale-work
recovery inside the connector, external ownership, mainnet readiness, worker
restart recovery or high concurrency. Mainnet was untouched.
