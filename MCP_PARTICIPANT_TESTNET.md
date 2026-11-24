# Local MCP work bridge (Base Sepolia)

The connector still owns discovery/claims, lease renewal, role authentication and
durable API retries. `src/participant-bridge.mjs` exposes its per-assignment file
handoff to the optional MCP stdio entry point in van-core:
`gateway/mcp/src/participant.mjs`. It does not replace the public read-only MCP
endpoint or introduce public authenticated HTTP tools.

Run the connector with your own admitted API credential and explicit worker
policy, as usual. Run the MCP process as the same trusted OS user, using a private
0600 JSON configuration inside a 0700 directory. Configuration contains only
`environmentId: "testnet"`, `role`, `agentId`, `instanceId`, absolute `stateDir`,
absolute `connectorSource`, and `issuer` settings (`socketPath`, `authorityId`,
`wallet`, `anchorDirectory`). There are no API tokens or private keys in this
configuration. The local independent issuer must already know the funded order;
this rehearsal's trusted admission adapter writes `admitted.json` in the private
anchor directory. Remote admission/transport remain separate work.

Launch with Node 24+, the gateway's locked MCP dependencies installed, and:

```sh
VAN_ENVIRONMENT=testnet VAN_NETWORK=testnet \
VAN_MCP_BRIDGE_CONFIG=/absolute/private/worker-mcp.json \
node /absolute/van-core/gateway/mcp/src/participant.mjs
```

Use your MCP host's stdio launch settings for that command. MCP stdout is reserved
for protocol traffic. No TCP listener is opened. The official SDK entry supports
legacy and modern client negotiation; both are tested.

Tools expose status, the current assignment, independent event preparation/send,
and role-specific report or review staging. Reviewers also request/read evidence.
Every action carries an opaque assignment ID. The bridge requires a fresh,
matching lease heartbeat, refuses stale assignments and freezes handler outputs.
The local wallet handler signs the returned non-payment `VANEvent` typed data;
only its signature goes through MCP. Worker staging requires an acknowledged
signature for the exact report. Reviewer staging validates retained API evidence
and requires the matching independently signed decision. Staging is not an API
acknowledgement or proof of payment; monitor the connector and order settlement.

An operator must quiesce old availability with zero-slot heartbeats (or wait for
expiry), not just stop old processes, before selecting a fixed test cohort. All
fixture wallets belong to VAN; these tests do not establish external ownership,
remote MCP authorization, A2A dispatch or production throughput.
