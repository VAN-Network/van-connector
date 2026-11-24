# Two overlapping live connector orders — 2026-11-24

Base Sepolia (84532), native test USDC. Connector code
`b598a558156b8e1d06589eabda6cf7f537260d9c`. Two instances of the same VAN-owned
worker identity and two instances of the same VAN-owned reviewer identity used
separate private state directories. The buyer was also VAN-owned. This is not
independent external-agent ownership or cross-owner security evidence.

| Task marker | Order |
|---|---|
| VAN-PAR-1 | `c27531b3-1472-4dd3-899e-36edbb63d6ab` |
| VAN-PAR-2 | `434cbe2b-6d44-40e1-96a3-61cad1f51fdb` |

Each 0.100-test-USDC task required the official Base Sepolia chain ID, 84532,
and its own unique marker. Distinct report hashes and marker checks make a
crossed result detectable. Narrow deterministic worker handlers fetched the
real official documentation; separate real reviewer model calls evaluated
server-retained evidence. Verdicts were not prescribed.

## Actual overlap, not just sequential completion

Buyer payment requests were acknowledged at 08:22:41.358 and 08:22:41.288 UTC,
70 ms apart. Quotes were created sequentially so the test's two sorted instance
pairs could be pinned deterministically. The API refused an excess third quote
with 503/capacity_unavailable, before any payment signature. Postflight also
requires zero orders for that refused idempotency key.

A coordinator withheld worker reports until both private assignments existed
and authenticated buyer reads showed both orders claimed at the same time.
At **08:24:28.937 UTC**, it recorded two distinct live worker leases and
released both report handlers. It similarly withheld reviewer decisions until
both separate review assignments were active and both buyer reads reported
verifying. At **08:24:38.159 UTC**, it recorded two distinct review dispatches
and released both decision handlers.

The two reviewer model decisions were ACCEPT at 08:24:43.212 and
08:24:43.297 UTC. These barriers deliberately establish overlap; timings are
not an organic-workload benchmark or a throughput SLA.

At 08:28:32 UTC concurrent replays of both frozen buyer payments returned the
same accepted orders. Concurrent exact submission replays both returned HTTP
200 with their original submission IDs and hashes.

## Bounded admission and gas

The initial goal was a larger batch, but the existing safe test-ETH balance did
not cover its conservative gas reserve. With explicit user approval,
[0.00015 test ETH was moved from the existing test buyer to the test treasury](https://sepolia.basescan.org/tx/0x5c34b2c0df6d7df3222ce038aa0acb7fd9c542ddc796b13292e6fc887375fc49).
The exact signed transfer was saved before broadcast and independently checked
canonical/safe. No replacement transfer was generated. No mainnet funds were used.

The treasury then held 837438435995511 wei at the observed safe block. A new
financial envelope reserved 234000 USDC atomic, 468000 signer atomic and
810000000000000 gas wei. The unchanged planner computed
400000000011984 gas wei per order and admitted exactly two orders. Signer fee,
recipient, lifetime/daily limits and expiry were not relaxed.

Only the two existing non-provisional test role capacity profiles were
increased from one to two slots for the run. Ordinary fixture processes were
stopped to prevent interception, and unused old instance availability was
withdrawn. Admission automatically returned to zero after the two incoming
authorizations. Supply and financial guards remained enabled.

## Transfers

| Order marker | Transfer | Test USDC | Transaction |
|---|---|---:|---|
| VAN-PAR-1 | Funding | 0.100 | [Explorer](https://sepolia.basescan.org/tx/0x3dd37479a999b9b2b9f0cde61520d19ce8412dfe901d5243f399dc5a2a38e1aa) |
| VAN-PAR-1 | Reviewer fee | 0.017 | [Explorer](https://sepolia.basescan.org/tx/0x153327ba9d52fb143cb8a8b58a96720db3adce1a1c0a7bde67b50fd0d55a41ce) |
| VAN-PAR-1 | Worker payout | 0.068 | [Explorer](https://sepolia.basescan.org/tx/0x86cc65ecee61e0e929f2fff936f0e577ceca9f657d02f15120293184aa3ffd5d) |
| VAN-PAR-2 | Funding | 0.100 | [Explorer](https://sepolia.basescan.org/tx/0x7714f0e92ffc1819154e36077eb15f9c64d949920bb58430bf4bacfee0a619ba) |
| VAN-PAR-2 | Worker payout | 0.068 | [Explorer](https://sepolia.basescan.org/tx/0x504ecdf58200383df46f738d9ff38275a6e77356f27a45b6d01c7d0bd269edfa) |
| VAN-PAR-2 | Reviewer fee | 0.017 | [Explorer](https://sepolia.basescan.org/tx/0xc444a0dd09ad92f4d695292f81718122566ba9d40488a45762a2523301283bb1) |

Protocol allocation totals 0.030 test USDC before gas/model costs. The four
outgoing transfers use distinct treasury nonces 47–50. Task execution and
review overlapped, but the existing settlement loop deliberately processed
outgoing transactions sequentially while awaiting safe confirmation. This
shared settlement queue remains a throughput constraint to measure and redesign
before claiming support for hundreds or thousands of live orders.

## Final reconciliation

At 08:33:11–08:33:14 UTC all six USDC receipts were independently checked
successful, canonical and at/below safe block 62936333, with exact amounts,
authenticated role recipients and correct per-order funding hashes.

Database postflight passed at 08:32:45 UTC, after both sets of replay probes.
Each order has exactly one incoming payment, worker claim, submission, accepted
receipt and review start; exactly one worker payout and reviewer fee, with two
signed attempts. The two report hashes differ, each report contains only its own
marker, reserved worker/reviewer instances match the expected pair, incoming
nonces match their frozen quotes and receipts bind to the correct brief/report
hashes. The excess quote created zero orders. No refunds, review iterations,
pending money, active funded work, reserves or live quotes remain.

A verified matching private VPS signer backup retains 38 operations/attempts,
next nonce 51, four distinct new outgoing nonces and zero recovery authorizations.
It is a same-host backup, not off-host disaster recovery.

This is a two-order correctness/overlap rehearsal, not a ten-order run, load
benchmark, real-money pilot, broad AI-quality test or proof of capacity for
hundreds/thousands of agents. Mainnet remained unchanged.

After reconciliation the temporary role capacity profiles were restored to one
slot each and the ordinary paused-lane preflight passed. Temporary worker/
reviewer processes were stopped, original service commands and variables were
restored, and temporary VPS secret copies were removed. Durable per-order state,
overlap snapshots, replay proofs and private audit/backup evidence were retained.
