# General Cashflow decision registry

This registry is the behavioral contract for human and agent actions. Navigation,
authentication, read-only reports, unattended inbox imports, and statement preview
are not human decisions. Every other browser mutation must carry a `decision_id`,
`reason_code`, and optional `reason_text`.

| Action key | Human surface | Mode | Risk | Required evidence |
|---|---|---|---|---|
| `receipt.create_from_pos` | Open a branch/day with no receipt | deterministic + human | medium | branch, date, POS totals |
| `receipt.backfill_from_pos` | Backfill branch/day receipts | deterministic + human | medium | requested date range and branch scope |
| `receipt.cashier_amounts.update` | Cashier save | shadow | high | entered amounts, POS expected totals |
| `receipt.submit` | Cashier submit | shadow | high | channel totals, open-table check |
| `receipt.misc_item.create/delete` | Miscellaneous receipt item | shadow | medium | label, amount, source explanation |
| `receipt.attachment.upload` | Attach evidence | assist | medium | file metadata and receipt |
| `reconciliation.settlement.update` | Settlement details | shadow | high | cashier, bank, gross/net/fee |
| `reconciliation.grab.confirm` | Confirm Grab report | shadow | high | report reference and totals |
| `reconciliation.manual_check` | Manual check without reference | human-only + shadow | high | typed reason and manual totals |
| `reconciliation.evidence.upload` | Add settlement evidence | assist | medium | file and reconciliation line |
| `reconciliation.statement.confirm` | Import selected bank rows | human-only + shadow | high | preview hashes, account, amount |
| `receipt.check` | Auditor check | human-only + shadow | high | all channel variances and reasons |
| `receipt.request_correction` | Return to cashier | human-only + shadow | high | correction note |
| `receipt.close` | Close day | human-only + shadow | critical | checked status and reconciled totals |
| `settings.*` | Branch/account/channel settings | human-only + shadow | critical | previous and proposed configuration |
| `report.morning_brief.refresh` | Generate a new brief | assist | low | selected date |

## Guardrails

- Shadow predictions use the frozen `context_snapshot` created before the reason dialog.
- The database keeps the complete audit snapshot, while credentials, authorization,
  API keys, tokens, and account numbers are redacted from the Shadow input copy.
- Shadow writes only `shadow_predictions` and trace data. It cannot write receipt,
  reconciliation, attachment, bank-inbox, or settings tables.
- The human workflow does not wait for Shadow and continues when OpenAI is unavailable.
- External bank/Gmail imports stay deterministic and do not impersonate a human decision.
- Agreement is an evaluation signal, never an authorization signal.
- Cancelling the reason dialog records `cancelled`, invalidates that context, and does
  not send the business mutation.

## Audit checklist

1. Every visible command is either a GET/navigation action or maps to an action key.
2. A mutation without decision metadata returns `422 decision_reason_required`.
3. Reusing a completed decision returns `409`.
4. High-risk actions always expose the final human confirmation in their existing UI.
5. Agent Health shows failures, agreement, disagreement, and recent run IDs.
6. Server tests fail when client/server semantic action mappings drift or when Shadow
   privacy redaction regresses.
