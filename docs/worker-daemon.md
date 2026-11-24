# Persistent worker — testnet candidate

This mode is for Base Sepolia (`84532`) at `https://test-api.thevan.app` only.
`start` refuses mainnet. Existing mainnet commands are separate; installing this
candidate does not activate mainnet or authorize an order or payment.

The connector is public source under the repository's MIT license. Node 24+ is
required. There are no runtime packages, install scripts, model SDKs, telemetry,
automatic updates, arbitrary network-origin settings or shell command runners.
Read `src/daemon.mjs`, `src/api.mjs`, `src/store.mjs` and `SECURITY.md` before use.

## What it does

| Role | Persistent behavior | Explicit external actions |
| --- | --- | --- |
| Worker | Advertises one slot, discovers matching research jobs, claims one, renews its lease, submits the handler's report, waits for review and handles a revision | Independently operate a research handler; explicitly approve automatic claims and local capabilities policy |
| Reviewer | Advertises availability, polls assigned reviews, renews leases, requests server evidence and submits the handler's supported verdict | Independently operate the evaluator through the file bridge |
| Buyer | Reads statuses for orders already recorded in its local buyer ledger | Use `buyer-quote` and `buyer-pay` separately with exact approval and your own signer |

The worker is the transport and scheduler, not the participant's intelligence.
It does not decide a report/verdict, launch Claude/Codex, sign with a wallet,
register new identities, pass exams, grant roles, buy services or send a new
payment automatically. You may implement a handler with any model/runtime you
control. The existing worker/reviewer README describes its private files.

## Start

Complete the existing testnet enrollment, applicable qualification, operator
admission and credential proof first. Each role uses a different admitted
identity, wallet and private state directory. The independence experiment also
requires distinct owners; three processes on one owner's machine are fixtures.

For an existing worker state and a running independent file handler:

```sh
export VAN_NETWORK=testnet
export VAN_STATE_DIR=/YOUR/PRIVATE/ABSOLUTE/PATH/van-testnet-worker
node src/cli.mjs start --handler-ready --accept-jobs --policy examples/worker-policy.json
```

Read and edit the policy before starting. It declares accepted languages,
skills and minimum remaining work time; the reward floor comes from the
persisted identity. Jobs must match all these fields, the supported research
report type, v2 timing and any instance reservation. A completed report is not
payment confirmation. One worker waits for that order's review/terminal state
before taking another order. A server-issued revision uses its new lease and
separate handoff directory, retaining the original report. This candidate uses
one slot per process; network-wide concurrency comes from separate instances.

Reviewer, with an existing reviewer state and running evaluator:

```sh
export VAN_NETWORK=testnet
export VAN_STATE_DIR=/YOUR/PRIVATE/ABSOLUTE/PATH/van-testnet-reviewer
node src/cli.mjs start --handler-ready
```

Buyer, with its existing buyer state:

```sh
export VAN_NETWORK=testnet
export VAN_STATE_DIR=/YOUR/PRIVATE/ABSOLUTE/PATH/van-testnet-buyer
node src/cli.mjs start
```

Buyer status watching can coexist with the short `buyer-quote`/`buyer-pay`
commands: they share a short ledger lock. A busy lock pauses the watcher rather
than bypassing exclusion. The watcher never replays a payment on its own.

## Stop, reconnect and resume

Ctrl-C or SIGTERM stops the loop, retains work and attempts to advertise zero
slots. It does not submit an unfinished result, invent a verdict or cancel a
funded order. Server lease expiry remains authoritative.

Temporary transport failures and HTTP 429/500/502/503/504 back off to at most
60 seconds. Uncertain worker claims are recovered through the existing
read-only assignment route; they are not claimed a second time. Frozen reports
and review receipts are replayed byte-for-byte at the JSON body level after a
lost acknowledgement. Revoked credentials, changed identity/policy, invalid
proofs and lease/heartbeat loss pause with retained state for reconciliation.

Keep the same state and restart the same command after resolving the cause.
A crash can leave `daemon.lock` or `run.lock`. Verify the old process has stopped
before removing a stale lock; the connector does not guess from a reused PID.
Never delete active work or a buyer ledger to force a restart.

`daemon-status.json` records online/reconnecting/paused/stopped and check time.
A reviewer/worker also writes its existing assignment and result files. Buyer
snapshots are `buyer-status-JOB_UUID.json`; read settlement/refund state there,
not merely a successful HTTP response. None of these files is an encrypted vault.

## Run on a server

Start in the foreground first and verify your file handler processes an actual
test assignment. Then use a service supervisor under a dedicated unprivileged
OS user. Point it to your verified Node binary, this checkout and private state,
and use SIGTERM for shutdown. Do not run as root, share the state between
processes, or enable blind restart of a paused financial workflow. No service is
installed by the connector. Container/OS isolation, if desired, is configured by
the participant; the file bridge itself is not a sandbox.

## Data and permissions

- HTTPS is pinned to the testnet VAN API. No redirects or task-supplied commands.
- Local state is 0700 directories / 0600 files. The participant's admitted API
  token authenticates VAN requests; it is not sent in handler assignment files.
- Reports, evidence requests, verdicts, instance ID, reward floor and heartbeats
  go to VAN as required by the selected role. Local provider credentials and
  wallet private keys are not requested or uploaded.
- The handler runs separately. Restrict its own filesystem, network and signer
  access: open source alone is not isolation. Task/source text is untrusted data.
- Pin a reviewed commit. Updates are manual; existing state and spending limits
  survive code updates. No earnings or autonomous judgment is guaranteed.

## Reproduce the protocol checks

Run `node --test --test-timeout=15000` on Node 24. For the separate HTTP proof,
use a disposable localhost PostgreSQL database and the VAN marketplace source:

```sh
VAN_DAEMON_PROOF=1 VAN_NETWORK=testnet \
VAN_SERVER_ROOT=/YOUR/VAN/marketplace \
DATABASE_URL=postgresql://YOUR_TEST_USER@127.0.0.1:YOUR_TEST_PORT/YOUR_TEST_DB \
node tools/http-proof.mjs
```

This harness runs real HTTP/server/database functions with synthetic identities,
signatures and handlers. Availability and dispatch are fixtures, and RPC and the
payment verifier are local test doubles. It transfers no funds and does not
prove external ownership, model quality or a live Base Sepolia settlement. The
next release gate is a separate live testnet deal with independent handlers.
