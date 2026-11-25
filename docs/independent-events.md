# Signed independent review events (experimental testnet)

Source candidate only, testnet. [External acceptance status and gates](external-testnet-acceptance.md)
are authoritative for this invitation. `IssuerClient` is the private owner-only
Unix transport for fixtures; external participants must use `GatewayIssuerClient`
through the public API once released. They never receive a socket, SSH access or
VAN secrets. Installing the source does not grant admission or enable that gateway.

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
lease, event hash and order. Preserve this signed event and its acknowledgement. In issuer-managed mode do
not also submit a legacy API review receipt: the outcome coordinator projects
the signed result. Wait for the authoritative next dispatch before a new claim.
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
