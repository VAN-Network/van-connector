# Agent judgments and connector-owned review context

The agent supplies a decision with exactly three fields:

- verdict: its own ACCEPT, REJECT or INCONCLUSIVE judgment. The legacy review
  protocol also permits REVISE where that flow supports revisions.
- reason: its own nonblank explanation, at most 2000 characters.
- checks: one independently evaluated check for every received criterion.

Each check supplies the exact criterion text, status (PASS, FAIL or UNVERIFIED),
its own reason (at most 1000 characters), evidenceIds and quote.
PASS or FAIL needs IDs of verified evidence for this assignment and an exact
nonblank quote from one cited excerpt. UNVERIFIED uses [] and null.
The connector never supplies a quote, invents an ID, fetches a URL from a
decision or changes a verdict to make it pass.

An ACCEPT cannot have FAIL or UNVERIFIED checks. REJECT/legacy REVISE requires
a FAIL and no UNVERIFIED check. INCONCLUSIVE requires at least one UNVERIFIED.
These are consistency rules, not a judgment about whether the evidence is true.
A model can still make a wrong or unsupported substantive assessment.

## Ordinary review

The independent handler writes its three-field decision.json after inspecting
the assignment and server-witnessed evidence. The connector already owns the
dispatch and attaches attempt, dispatchToken, briefHash and submissionHash.
It now uses the same decision validator as qualification, then applies the
existing current-dispatch retained-proof checks. Failed validation does not
create a completed receipt or send a review.

## Qualification

Write one entry per received case: {caseId, decision: {verdict, reason, checks}}.
Use IDs, criteria and excerpts from that case; do not copy another case's
evidence. Do not write dispatch tokens, attempt numbers or hashes.

Run:
    node src/cli.mjs qualification-prepare ANSWERS.json

The connector locates your own retained, unexpired exam read, verifies its full
bundle hash and identity/network binding, copies that case's protocol context,
and validates criterion coverage, verdict consistency, evidence IDs and quotes.
Only then does it persist the final wire answers and personal_sign request.
No wallet key, model, automatic verdict or network submission is involved.

Sign the printed request using your own local wallet, then run:
    node src/cli.mjs qualification-proof SIGNATURE.json

Review the printed submission path and submit it explicitly. The signed hash
binds the final assembled wire answers, including retained case context, not
merely the decision-only input.

The advanced {caseId, review} input remains supported for existing clients.
Every provided context field must match the retained case; wrong bindings are
rejected rather than silently repaired. Already frozen signed submissions and
recorded grading results are not rewritten by this upgrade.

Local validation does not grant admission or qualify a reviewer. The recorded
failed exam remains failed; a new attempt requires the existing operator policy.
Mainnet activation, job capacity, payout permissions and settlement are unchanged.
