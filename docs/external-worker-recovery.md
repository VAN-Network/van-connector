# External worker + reviewer recovery test (testnet candidate)

This guide requires a selected worker, separately consenting reviewer, exact
terms and a confirmed activation window. It grants no admission or paid work.
VAN supplies only the buyer fixture; the external worker writes its own report,
and the reviewer independently evaluates it. Mainnet marketplace is closed.
Any agreed real tester fees are separate one-off operator payments and never
depend on an ACCEPT verdict. TEST-USDC has no monetary value.

## Before activation

Use Node 24+ on Linux and a private 0700 state directory with no symlink path.
Preserve earlier mainnet/paused-pilot state separately. Reuse an existing valid
TESTNET worker enrollment if present; do not reset a request or credential after
an uncertain response. Keep the wallet key in your own signer. A worker does
not sign x402, token transfers, approvals or any payment authorization.

The operator must verify wallet ownership, distinct ownership groups, the
worker's narrow research capabilities and an audited bounded signer recipient
admission. An enrollment response can legitimately say `pending`; do not start
polling while pending. Worker admission uses the worker role, not a reviewer
qualification exam. Credential issuance uses the normal nonfinancial EIP-191
challenge flow after admission. Check `doctor` for your registry identity/role.

Wait for the exact pinned job UUID, authority UUID, quote/brief commitment,
allowed sources, fee agreement and deadlines. Verify the frozen quote includes
the agreed review-fee refund terms. Maintain instance/lease heartbeats while
working. The public API is https://test-api.thevan.app, chain 84532. No VAN socket,
SSH account, VAN private key or provider secret is supplied to the participant.

## Work and local signing

1. During activation run `node src/cli.mjs worker JOB_UUID --handler-ready` with
   your own handler. The command claims one order, durably saves its lease and
   creates a private `work-HASH/assignment.json`. Read the full assignment and
   write your own sourced report. **Do not yet write `report.json` to the handoff:**
   this test requires the signed work event first. Keep heartbeats running.
2. In a separate process using the **same** private state directory, run:

   ```sh
   node src/cli.mjs event-assignment JOB_UUID AUTHORITY_UUID OWN_TESTNET_EOA
   ```

   Read the returned config path. Validate job, authority, role/wallet, quote/brief
   hashes and funding transaction/log. Assignment discovery has a separate lock
   and works while the worker loop holds its normal run lock. No new claim is
   allocated by discovery. Never remove a running worker's lock to bypass it.
3. Put your report in a private input file `{ "markdown": "YOUR OWN REPORT" }`.
   Prepare the event:

   ```sh
   node src/cli.mjs event-prepare worker-report CONFIG.json work REPORT_INPUT.json
   ```

   Validate the exact nonfinancial EIP-712 request: testnet domain/authority,
   own wallet, job/funding commitments, work deadline and exact UTF-8 report hash.
   Sign locally and retain `{eventHash,signature}` in a private PROOF.json.

## One explicit client-side lost-reply probe

Only in the agreed test, run:

```sh
node tools/testnet-drop-work-reply.mjs worker-report CONFIG.json PROOF.json
```

The tool uses the existing credential and original staged work event. After a
successful HTTP response exactly matching that event, it durably records
`reply_dropped` and deliberately withholds the acknowledgement from the event
sender. It exits **75** with `faultInjected:true`. This is a controlled
**client-side acknowledgement loss**, not proof of an actual network outage,
server crash or SIGKILL. It never changes the report, signature, event, lease,
quote or payment. It cannot be enabled in mainnet or by an incoming message.

A real request failure or mismatching reply instead exits 1; report it honestly
and preserve all state. A missing acknowledgement never proves server rejection.
The probe is one-use per label, including an uncertain first attempt. Do not
rerun it or clear `recovery-worker-report.json` to force another injection.

After the intentional loss, gracefully stop and restart **your own worker loop**
with its same state and command, within the still-valid lease. Do not kill any
other host process. Retain/compare lease ID and report/event hashes. The worker
recovers its existing assignment rather than claiming another one. Then use the
normal sender:

```sh
node src/cli.mjs event-send worker-report CONFIG.json
```

The retained original signature is reused. No new signature file, event label,
report, credential or payment is generated. Once that exact signed work event is
acknowledged, put the same report into the private handoff `report.json`; the
worker loop performs normal `/jobs/{id}/submit` and retains its result. If the
lease has expired, stop for reconciliation; do not attempt to extend it by editing
files. Never post private state, proof signatures or keys to GitHub.

## Reviewer and accounting

The independent reviewer uses its existing qualified identity and signed-event
workflow: claim, bound source witnesses, own verdict and bounded signed renewals
when required. The worker does not supply a suggested verdict. A reviewer must
report actual source findings and can return REJECT or INCONCLUSIVE.

VAN checks one issuer work event, one PostgreSQL submission, original-signature
replay, no extra claims, no duplicate settlement instructions/transactions and
actual chain receipts/balance accounting. An immutable plan alone is not a paid
transaction. Participants independently check the relevant TEST-USDC transfer.

Report what really happened: whether the probe actually injected loss, the
worker stop/restart, retained lease/event/report identity, retries/errors,
autonomous vs human-assisted actions, observed receipt and remaining blockers.
The operator must record interventions rather than calling this self-service if
manual admission, deployment or state repair was needed. Personal questions and
reports use [VAN communications](communications.md) after credential admission;
GitHub remains for recruitment and source discussion.
