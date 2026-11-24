# Signed independent review events (experimental testnet)

This interface is restricted to the private testnet issuer channel. It is not a
public enrollment endpoint, mainnet support, or a replacement for VAN API leases.
The current server socket is local to the trusted VPS; installing this connector
does not grant access to it. The participant signs an exact event locally. No
wallet key or VAN API bearer belongs in issuer requests.

`src/issuer.mjs` exports `IssuerClient`, `prepareIssuerEvent` and
`submitIssuerEvent`. Pin the authority descriptor and the complete assignment
anchor (order, quote, brief, funding transaction/log, participant role/wallet and
submission hash for reviews). The local signer must validate the event's exact
EIP-712 scope. The connector rejects payment signing requests and foreign scope.
Use separate persisted state for each dispatch; keep signed bytes for retries.

A completed INCONCLUSIVE review is different from a silent or expired lease.
The issuer records the first two completed INCONCLUSIVE reviews immutably and
returns an acknowledgement such as:

```json
{
  "version": "van-local-review-pending-v1",
  "outcome": "INCONCLUSIVE",
  "eventHash": "<exact signed event hash>",
  "orderId": "<pinned order UUID>",
  "leaseId": "<pinned issuer lease UUID>",
  "attempt": 3,
  "completedReviews": 1
}
```

The attempt number can exceed the completed-review count because earlier claims
may have expired without a review. This acknowledgement contains **no monetary
operations** and grants no payout. The connector validates its exact shape,
lease, event hash and order. Preserve and submit the corresponding API review
receipt, then wait for the next API dispatch before signing a new issuer claim.
Do not treat the acknowledgement as the end of the order.

Only the third completed qualifying INCONCLUSIVE review produces the immutable
`van-local-settlement-plan-v1` with the quote's 83% refund and 17% reviewer fee.
Silent claims have a separate bounded failure budget; three silent processing
failures yield a technical-timeout plan and full refund. New assignments have a
bounded pool of nine claim IDs; old immutable contexts are not silently expanded.

After a lost reply, replay the same persisted signature and event. Replacing the
input, event hash, signature or transport binding is refused. A replay of an
already recorded nonterminal review returns its original acknowledgement even
after the next claim starts. It does not increment the completed-review count.

These are transport and state guarantees. They do not establish independent
ownership or the quality of a participant's judgment. A final issuer plan alone
is not proof of chain settlement; VAN reconciles PostgreSQL, the signer journal
and confirmed chain transfers separately.
