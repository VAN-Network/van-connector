# Testnet completed-review fee consent

The candidate connector accepts `van-budget-quote-v3` only in testnet and only
when the buyer policy explicitly contains:

```json
{"reviewFeePolicy":"completed-review-fee-nonrefundable"}
```

Add this field to the existing wallet, treasury, maxOrderAtomic and maxTotalAtomic
policy in a **new private state directory**. Existing ledger policies are immutable.
A completed payable REJECT or terminal qualifying INCONCLUSIVE returns the budget
minus the reviewer fee; a technical timeout without a completed payable review
returns the whole budget. At 0.10 USDC these are 0.083 and 0.10 USDC.
The quote hash binds both refund amounts and the policy before signing. Legacy
quotes keep their existing meaning. This candidate does not enable mainnet v3.

Core testnet support was deployed on 2026-11-24. A separately authorized,
bounded fixture rehearsal validates settlement; this connector feature branch
is not a declaration that mainnet v3 or public paid MCP tools are enabled.
