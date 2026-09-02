# LINE Bill Capture decision registry

All desktop, `/m2`, and legacy `/m` business mutations are linked to a human
decision event. Read-only navigation, image viewing, search, AI category-review
clarification, authentication, LINE webhook ingestion, and scheduled workers are
excluded.

| Action key | Human surface | Mode | Risk | Required evidence |
|---|---|---|---|---|
| `match.review` | Confirm/reject/change one pair | human-only + shadow | high | bill/slip IDs, amounts, chat context |
| `match.learning_feedback` | Correct AI reason/ranking on a human-confirmed pair | human-only + shadow | medium | stored AI reasons and typed correction |
| `match_group.review` | Multi-bill/multi-slip group | human-only + shadow | high | deduplicated members and aggregate totals |
| `document.metadata.update` | Correct bill amount/metadata | shadow | high | image, OCR, chat announcement |
| `document.amount_flag.resolve` | Clear amount flag | human-only + shadow | high | document amount versus announced amount |
| `document.category.change` | Bill/slip/other correction | shadow | medium | image and typed reason |
| `document.match_state.repair` | Repair a stale unmatched bucket | deterministic + shadow | medium | item category and current match references |
| `cash_payment.confirm/update/void` | Cash settlement | human-only + shadow | critical | bill amount, recipient, note/reason |
| `receipt_substitute.create` | Create substitute receipt | human-only + shadow | critical | slip, payer/payee, purpose, date, amount |
| `reimbursement.review` | Review advance/reimbursement | human-only + shadow | high | both transfers and evidence mode |
| `batch_payment.split` | Split supplier payment summary | human-only + shadow | high | source image and line totals |
| `line.transfer_request.send` | Push bill image and text to LINE | human-only | critical | explicit preview and confirmation |
| `day.close/reopen` | Daily close state | human-only + shadow | critical | unresolved count and transaction totals |
| `ai.analysis.reset` | Re-read a scoped period | human-only | high | exact date/group scope |
| `ai.items.requeue` | Retry failed/scoped items | assist | medium | IDs or explicit queue filter |
| `ai.matches.rebuild` | Rebuild candidate pairs | deterministic | medium | current analyzed items |
| `ai.queue.run/pause` | Worker control | assist | low | visible scope and queue status |
| `documents.deduplicate` | Mark byte duplicates | deterministic + human | high | SHA-256 and same-group rule |

## Guardrails

- Shadow receives only the pre-decision metadata/context snapshot, not the user's
  eventual reason or the mutation result.
- The full snapshot remains in the local audit record. Account numbers, credentials,
  authorization headers, API keys, and tokens are redacted from Shadow input.
- It writes only decision/shadow/follow-up rows and JSONL traces.
- LINE push, day close, deletion/void, amount changes, and confirmed-match
  replacement remain human-only even when Shadow confidence is high.
- Existing AI learning examples remain owner-approved prompt examples. Shadow
  disagreement is never promoted into those tables automatically.
- For `match.review`, pressing a structured reason button is the human approval event. Confirmed
  pairs become positive examples; rejected or unconfirmed pairs become negative examples. Custom
  reasons require explicit text confirmation.
- Participant roles are supporting context only. They cannot prove a document category, payment
  direction, completed transfer, or reimbursement without image/chat evidence. The canonical role
  registry and quality snapshot are in [AI_LEARNING_STATUS.md](AI_LEARNING_STATUS.md).
- AI workers may create only `pending` proposals. `confirmed` always requires a
  human mutation; startup moves legacy AI-only confirmations back to review.
- OpenAI failure never blocks a human mutation after the reason is supplied.
- Cancelling the reason dialog marks the decision `cancelled`; the context cannot be
  reused and no business mutation is sent.
- Operators may attach up to 6 nearby active LINE messages/images. The selected
  message IDs are resolved server-side and stored as immutable audit snapshots;
  unselected chat context is not presented as human evidence.

## Audit checklist

1. All non-GET `/api/admin` browser mutations require decision metadata.
2. LINE webhook and scheduled recovery never create fake human decisions.
3. `/m2` uses quick reason chips; `/m` keeps a text fallback.
4. Agent Health exposes run status without revealing hidden predictions before a
   human commits the action.
5. Agreement reports must be segmented by action key before any assist feature is promoted.
6. `npm run check` verifies the semantic action mappings across server, desktop,
   `/m2`, and legacy `/m`, plus cancellation, Shadow-input redaction, and selected
   LINE-chat evidence persistence.
