# A2A research execution adapter — Base Sepolia

`src/a2a-worker.mjs` maps one current VAN worker assignment to one pinned A2A
0.3.0 JSON-RPC task. `src/a2a-step.mjs` runs one durable step as a short-lived
process. The connector continues to own VAN discovery, claims, heartbeats and
exact API retries. The local wallet signs the independently verified work event
after A2A execution; neither VAN credentials nor wallet/payment signatures are
sent to the A2A execution peer. An A2A report is untrusted work, not an accepted
VAN review or authorization to pay.

This initial version supports public research briefs only. It is testnet-only,
free at the A2A transport boundary, and exposes no public VAN task-submission
endpoint. A2A 1.0/other transports, authentication and automatic payment fallback
are not supported. An operator must first obtain consent and review/pin the exact
peer card URL, endpoint, protocol, skill and consent reference in private config.
An AgentCard is a routing/capability declaration, not ownership or admission proof.
The registered VAN worker and any separate downstream execution operator must be
disclosed when evaluating independence; using A2A does not change the payee.

## Peer profile

The peer advertises protocol `0.3.0`, JSONRPC transport, skill
`van-research-report-v1`, and `application/json` input/output. This is a VAN work
profile over standard A2A messages/tasks, not a claim that every A2A agent already
implements it. Message data contains:

```json
{
  "schema": "van.research-report.request.v1",
  "binding": {
    "environmentId": "testnet",
    "audience": "https://test-api.thevan.app",
    "role": "worker",
    "jobId": "ORDER_UUID",
    "assignmentId": "OPAQUE_64_HEX_ASSIGNMENT_ID",
    "briefHash": "64_HEX_SHA256_OF_CANONICAL_BRIEF",
    "workDeadline": "ISO_TIMESTAMP"
  },
  "bindingHash": "SHA256_OF_CANONICAL_BINDING",
  "brief": {}
}
```

There is no VAN lease/dispatch token in this payload. The peer returns a Task
with stable `id`, `contextId`, and `metadata.vanBindingHash` equal to the request.
On completion, exactly one artifact contains one inline DataPart:
`{schema:"van.research-report.result.v1",bindingHash,markdown}`. The report is
limited to 65536 UTF-8 bytes. File links, callbacks, executable data, task/context
substitution and unbound artifacts cannot become a report. The adapter does not
fetch remote artifact URLs or execute instructions in returned content.

## Recovery and limits

The exact outgoing message is saved before the first POST; task/context IDs are
saved before polling. A lost `tasks/get` reply is recovered by polling the same
task, including after process/peer restart. Every step checks the current VAN
assignment before and after network I/O; a late completion is marked late and
cannot be staged or signed for a replacement lease.

If the initial POST reply is lost before the server's task ID is known, the state
becomes `uncertain`. It is never automatically resent or replaced. A2A 0.3 does
not provide this adapter a general task lookup by client message ID. Keep the
state for operator reconciliation; do not delete it to manufacture a fresh send.
The private store fails closed if an adapter itself is killed while holding its
lock: verify that process has stopped before reconciling/removing a stale lock.
The automatic crash-recovery test kills the peer, not a lock-holding adapter.
Input/auth-required, failure, payment requests and context mismatches do not
authorize credentials, spending, another claim or another task.

Public peers require HTTPS on port 443 and public DNS/IP answers pinned at the
actual socket lookup; private/mapped addresses and mixed public/private answers
are refused. Redirects, cookies, auth/payment headers, proxies and compression
are not used. Request/response bounds are 96/128 KiB; timeout is 10 seconds per
request. An explicit literal-127.0.0.1 `loopback-testnet` mode exists only for
controlled tests; it does not open a firewall port or public server.

## Local invocation

Node 24+, no additional package dependency:

```sh
VAN_ENVIRONMENT=testnet VAN_NETWORK=testnet node src/a2a-step.mjs /absolute/private/a2a-worker.json
```

The 0600 config in a 0700 directory contains the same environment/role/agent/
instance/stateDir/issuer binding as the participant bridge, plus `peer` with
exact keys `cardUrl`, `endpoint`, `protocolVersion`, `transport`, `consentRef`,
`skill`. It contains no API token, wallet or model key. The process runs under
the connector's trusted OS user; this is not OS-level sandbox isolation.
`waiting` means retry the same saved task; `ready` returns untrusted Markdown.
The worker's local handler then signs/submits the independent event and stages
the report through `ParticipantBridge`. Neither A2A completion nor report staging
is proof of VAN acceptance or payout.

The controlled HTTP peer in `test/fixtures/a2a-peer.mjs` is an integration fixture,
not a production agent. Tests cover actual socket loss/restart, uncertain first
acknowledgements, late results, changed peers/contexts, SSRF and free-only bounds.
The late-result and unknown-first-acknowledgement cases also use real loopback
HTTP, without creating paid orders or broadcasting transactions.
