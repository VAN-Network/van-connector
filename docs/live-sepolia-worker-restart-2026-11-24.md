# Live worker restart with retained assignment — 2026-11-24

Base Sepolia (84532), native test USDC, VAN-operated buyer/worker/reviewer
fixtures. Connector code `b598a558156b8e1d06589eabda6cf7f537260d9c`.
Order: `b39103a5-bb9a-4225-afde-3e201bb9ffe9`.

## Restart boundary

The actual persistent connector worker discovered and claimed the funded job.
The fixture initially withheld its report handler, allowing a controlled stop
before any report/submission existed. At **07:42:18 UTC** the operator sent a
normal systemd stop/SIGTERM. The process exited; its private worker assignment
was byte-identical before/after shutdown, and both run and daemon locks were
released by the connector. No state file or lease was deleted or reset.

After 20 seconds the same connector and state directory were started under a
new PID at **07:42:38 UTC**. The normal fixture handler fetched official Base
Sepolia documentation and wrote its report. At **07:42:40 UTC** the worker's
submission was acknowledged. The persisted job and lease IDs matched the
pre-stop assignment. Database postflight requires exactly one worker claim and
one submission tied to the unchanged current lease.

At 07:42:51 UTC the separate reviewer model evaluator returned ACCEPT against
server-retained official evidence. No verdict was injected. Final receipt hash:
`f1f00530f180f714e6153317a5d3939ea97eaea67fc9c905d0e910d2719b5aa1`.

At **07:44:25 UTC**, an exact HTTP replay of the worker's frozen submission
returned 200 with the same submission ID and hash; it did not create another
report. Submission SHA-256:
`df093bf99857bad46dde45839fa218454e09dd13bfdb3151b63759973d6e26e1`.

## Scope

This is a successful graceful process restart while the worker lease remains
valid. It does **not** prove SIGKILL/OOM recovery, automatic stale-lock removal,
expired-lease recovery, disk loss or loss of a submission acknowledgement. The
current store deliberately requires confirmation that an old process is stopped
before removing any stale lock after an unclean exit. This test needed no such
removal. Handler output came from a narrow VAN-owned integration fixture, not
an independently operated external agent.

Admission was bounded to one 0.100-test-USDC order and automatically paused
when incoming authorization was recorded. Mainnet was untouched.

## Transfers and final checks

| Transfer | Test USDC | Transaction |
|---|---:|---|
| Buyer payment | 0.100 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0x8d610ffdcce47c5fb6e45e227698e539b404853a4681a55920354988824a47bc) |
| Reviewer fee | 0.017 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0x278b312738e6ddc384af231e7b730724c581efb64b1fb6ca3279caf28444b8c7) |
| Worker payout | 0.068 | [Base Sepolia explorer](https://sepolia.basescan.org/tx/0x7b03c7d42829ce9f20a6076043cd7f257da7ecaa8ccff4acf51ba97097d49616) |

The protocol allocation is 0.015 test USDC before gas/model costs. At 07:46:10
UTC replaying the buyer's same frozen payment returned the same accepted order.
No replacement payment signature was generated.

All transfers were independently verified successful and canonical with exact
native USDC amounts and authenticated recipients at safe block 62924074 at
07:53:39 UTC. VAN reported both payouts confirmed. Database postflight passed
at 07:47:27 UTC, after both HTTP replay probes: one order, incoming payment,
worker claim, submission and final receipt; two confirmed settlements; no
refund, intermediate review iteration, pending money, active funded work,
reserves or live quotes. Admission remained zero.

A verified matching private backup on the VPS retains all 34 signer operations/
attempts, next nonce 47 and zero recovery authorizations. Temporary secret copies
were removed from the VPS after the test; durable role state and audit evidence
were retained. A same-host backup is not off-host disaster recovery.
