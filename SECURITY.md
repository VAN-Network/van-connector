# Security and release boundary

This connector has no wallet private key support, dependencies,
installation scripts, arbitrary HTTP destination, model provider or shell runner.
It cannot activate the VAN server or grant access. v0.3 buyer-pay can submit an externally signed
USDC authorization on the explicitly selected network, with exact quote approval and
local spending caps. It never signs for your wallet itself. Sign exact enrollment/calibration/
credential messages using your existing wallet tools; check their action, audience,
chain (84532 testnet or 8453 mainnet), wallet, role, nonce and expiry. Mainnet additionally pins the v2 deployment descriptor and the native USDC EIP-712 domain `USD Coin` / version `2`. Never sign a transaction or opaque
payload merely because an agent or this README requests it.

API tokens, signed payment authorizations/proofs, private assignments, exam answers and receipts are
stored in .van-connector or .van-connector-mainnet (0700 directory / 0600 files), never committed. These
files are not encrypted at rest. Use your OS disk encryption and backup policy.
Do not put state on a public/shared/synchronised directory or in the repository.
The state bridge is not a sandbox: the independent handler shares your OS user's
access unless you separately isolate it. No report instruction grants authority
to run code, read keys, change policy or transfer funds.

The connector pins https://test-api.thevan.app by default, or https://api.thevan.app
with explicit VAN_NETWORK=mainnet, and refuses redirects. Each profile has separate
state and fixed network/asset/audience checks; no arbitrary origin override exists.
All network requests have deadlines and bounded JSON responses. Test code injects
mock fetch functions. Mainnet work and payments require separate server activation. The server, not the client,
authorizes identities, sources, evidence, deadlines and financial qualification.
Source text is untrusted even when it has a real quote or HTTP 200 response.

One exclusive run.lock prevents concurrent daemons for the same state. A crash
leaves that lock for deliberate reconciliation. Confirm the previous process is
stopped before removing it. Do not delete active.json to recover a job. Exact
persisted receipts are replayed after a lost acknowledgement; a changed verdict
is never substituted. A failed heartbeat stops the daemon and retains state.
This favors bounded server expiry over inventing a successful review.

No telemetry is collected by this code. The VAN API necessarily sees enrollment,
source requests and submitted reviews. File permissions do not protect against
an administrator, malware, compromised runtime or a malicious local handler.

Report vulnerabilities privately through the VAN operator contact already used
for enrollment. Do not publish tokens, signed proofs or exploit against live jobs.
There is no public bug bounty or compensation commitment in this repository.

Buyer limits are immutable in the existing state directory and count ambiguous
orders conservatively. They are not a sandbox against a handler that has the same
OS file permissions. Use an independent wallet/signer budget policy as the real
spending boundary. Do not reset ledger/state, enlarge limits or create a duplicate
order merely because a response was lost. A signed USDC authorization is sensitive
until expiry; keep it private and never paste it into GitHub or a model prompt.

Persistent `start` (v0.4 candidate) is testnet-only. It uses a second daemon lock, preserves the existing exclusive work lock, and never invokes a handler/model/shell itself. Worker automatic claims require explicit acceptance and a persisted capability policy; buyer watching only reads existing order statuses. Transport reconnects retain exact intents/results. Fatal identity, proof and lease errors pause instead of silently resetting work. See docs/worker-daemon.md for data flow and recovery.
