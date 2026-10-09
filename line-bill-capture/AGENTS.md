# AGENTS.md — line-bill-capture

## Search and source archive — user instruction 2026-10-04

Follow the root `AGENTS.md` and `../docs/REPOSITORY_HYGIENE.md`. Normal `rg` searches honor the repository `.ignore`; search source/public/mobile-admin-v3/scripts before historical evidence. Old HTML mockups moved to `docs/archive/mockups/` and are not served application pages. Read a specific archived file only when the task needs design history. New artifacts belong on verified SSD; existing DB/images/backups stay preserved.

## Local SSD requirement — user instruction 2026-10-04

Read `/Users/surachart/.solao-tools/SSD_POLICY.md`. Local backups/test/simulation/generated output must use the verified external SSD only. `preview` and `preview:sync` now use `/Volumes/SSD Files/SOLAO/line-bill-capture/previews/data` through `scripts/ssd-storage.mjs`; sync preserves the previous preview in SSD backups. Historical `.local-preview` references below describe the old path and must not be used for new data. Run artifact-producing tests/builds through the shared SSD snapshot runner; no fallback if SSD is unavailable. Production `/data` and service-local deploy roots are unchanged.

Context file for AI coding agents (Claude Code, Cursor, ChatGPT, etc.) working on
this service. Read this first. Product UI and code comments are in **Thai**;
this doc is in English + Thai domain terms so any AI can parse it.

> **กติกาสำคัญ:** เมื่อแก้โค้ดที่กระทบสิ่งที่เอกสารนี้อธิบาย (ตาราง/คอลัมน์ใหม่,
> route ใหม่, env var ใหม่, flow หลัก, ค่า enum) **ต้องอัปเดตไฟล์นี้ในคอมมิต/การแก้เดียวกัน**
> ดูรายละเอียดที่ท้ายไฟล์ "Rules for keeping this doc updated".

---

## 1. What this is

A back-office web service that captures **bill** and **transfer-slip** images sent
into **LINE OA group chats** by a fresh-market ordering business (ระบบสั่งของตลาดสด),
runs AI vision OCR on them, auto-matches each bill to its paying slip, and gives an
admin UI to review/confirm matches and close each day's books.

It is a **standalone app** living inside a larger monorepo. It has its **own SQLite
database and its own Railway service** — it is NOT part of the parent "market order" app.

## 2. ⚠️ Deploy guardrail (read before deploying)

Deploy is via **Railway CLI**, uploading THIS directory as the service root — NOT git,
NOT the repo root.

```bash
# from line-bill-capture/
railway service link line-bill-capture   # project: market-order-system, env: production
railway up --detach --path-as-root .
```

- **Never deploy the repository root to this service.** The root is the separate market-order app.
- The parent repo's working tree is usually dirty with unrelated changes — that does not affect this deploy (upload is file-based, respects `.dockerignore`).
- Keep the service-local `.gitignore` in sync with `.dockerignore`; Railway CLI builds the upload archive from this directory and must exclude `.env`, local preview databases/images, recovery files, and `node_modules` before Cloudflare receives it.
- Always run `npm run check && npm run smoke` before deploying.
- For a configuration-only change, verify the current successful deployment and redeploy that runtime with `railway redeploy --service line-bill-capture --yes --json` in the linked production project. Do not upload unrelated dirty local source. Verify the new deployment reaches `SUCCESS`, health, login, and protected data afterward.
- If the canonical service contains unrelated pending changes, an isolated controlled release may be staged under verified SSD `releases/` from the current deployed runtime with a baseline hash manifest, applying only the reviewed source patch. This is distinct from a `runs/` simulation and must have its own tested copy. Preserve deployed frontend bytes when frontend changes are outside scope; an explicit release Dockerfile can copy those compiled assets. Never include runtime credentials, DB or uploads. Upload only that service release root with explicit project/service/environment, then verify runtime hashes and data. The 2026-10-05 operator-only release uses this process; canonical source/docs keep the matching patch for future normal releases.
- `railway.json` requires `/health` to pass before Railway promotes a new deployment.

## 3. Stack & how to run

- **Runtime:** Node.js 24 (ESM, `"type":"module"`), Express.
- **DB:** native file-backed SQLite via Node's built-in `node:sqlite`, in WAL mode. One writer
  at a time remains serialized by the in-process `writeQueue`. `db.js` keeps a small
  sql.js-compatible statement adapter so existing query helpers retain their
  `step()` / `getAsObject()` contract without loading or exporting the whole database in RAM.
- **Desktop frontend:** one self-contained file `public/index.html` (dense, near-minified inline JS/CSS).
  The daily desktop workspace always keeps the full-day LINE chat visible for the selected group/date;
  selecting an empty work bucket must not replace the chat with an empty bucket message.
  On screens ≥1181px, `public/desktop-workspace.{css,js}` fits chat, work list and review detail into one
  viewport (each scrolls on its own). When the work panel is ≥760px wide the list sits left of the detail,
  otherwise above it; ↑/↓ or J/K moves between list rows when focus is not in a form field or dialog.
  These files only change layout/navigation and never write decisions; mobile widths are unaffected.
  A view switch beside the AI menu offers แบบเดิม / Liquid Glass / โต๊ะเทียบเอกสาร, remembered per browser
  (`localStorage` key `lbc-admin-view` = classic|glass|desk). Liquid Glass is a CSS-only theme for every page
  (`public/glass-theme.css`, active when `<html class="theme-glass">`, also used by the desk) plus SF-style icons
  injected by `public/desk-view.js`. The document desk lives in `public/desk-view.{css,js}`.
  Glass/desk modes have a colour switch อัตโนมัติ/สว่าง/มืด (`localStorage` key `lbc-admin-scheme` = auto|light|dark)
  that sets `<html class="glass-dark">`. `public/glass-dark.css` is GENERATED from the page's hard-coded light
  colours by `node scripts/build-glass-dark-css.mjs`; rerun it after changing colours in `public/index.html` or the
  extra CSS files. Hand-tuned dark rules for main components sit at the end of `public/glass-theme.css`.
  In Liquid Glass on screens ≥1100px, `public/glass-dock.{css,js}` turns the review panel's bottom bar into a floating
  dock: secondary actions (`#workflow-more`, problem choices, add-note/teach) move into a ⋯ menu, document-type buttons
  into one type menu, skip/transfer/cash become icon buttons, and the round actions (`#reread`, `#pause-ai`, `#printday`)
  move into a ⋯ beside `#closeday`. Bucket tabs become equal-size icon+count cells (empty buckets folded behind ▾) so they
  never shift when selected. Every dock/menu item is a proxy that calls the original button's `.click()`; the originals stay
  in the DOM (hidden with `.gl-hide`) and rebuilds are signature-based to avoid loops with other scripts that edit the panel.
  It also merges the top area into one row: `#backbar` (day header) is moved into `header.top` (moved back in other views),
  `.tools`/`#backbar` use `display:contents` and CSS `order`, the view switch becomes one eye menu, and low-priority
  controls turn icon-only on narrower desktops. In the chat it hides the floating date and per-message sender details
  (LINE ID moves to the name tooltip), caps image height, and groups consecutive messages from the same sender within
  10 minutes (`.chatmsg.gl-cont`). Rebuilds are scheduled with `setTimeout` (not rAF) so they still run in background tabs.
  `public/glass-ocr.js` highlights the AI-read amount (and an all-digit `doc_ref`) on document images in the glass/desk views.
  AI results store values but no positions, so it runs Tesseract OCR in the browser from self-hosted files in
  `public/vendor/tesseract/` (tesseract.js 7.0.0, core 6.1.2 SIMD-LSTM, eng 4.0.0_best_int; Apache-2.0, ~6.8MB, loaded only
  when a document image is shown). Images never leave the browser and nothing is written to the server; results are cached
  per viewer in `localStorage` (`lbc-ocr-v2:<item>:<values>`). Boxes are green when the amounts of the documents shown together
  match, red when they differ, yellow for a single document; when OCR cannot find the number a small badge shows the value.
  It is a presentation layer only: decisions call the page's existing `update()`, `drawer()`, ask-why dialog,
  expense entry and close-day buttons, so server rules, undo and audit stay identical. Mismatched-amount pairs
  cannot be confirmed from the desk. Local phase 2 adds board/flags and every daily bucket on the desk (desktop ≥1100px).
  `desk-board-flags.{js,css}` registers board/flags views; `desk-complex.{js,css}` handles groups, reimbursement, batch
  and minor buckets; `desk-completed.{js,css}` adds deduplicated completed work and native payment filters.
  The UI-only `window.LbcDesk` registry selects original rows before rendering/proxy clicks. No new API or financial rules.
  Desk actions select the original row before clicking its original button. Secondary forms/controls are moved,
  not cloned, into a desk sheet and restored when closed; the complete original panel stays accessible there.
  Before native render, restore the moved form; for unchanged scope, reopen the fresh source form and restore editable
  draft values. Keep fresh handlers/disabled guards and never copy hidden revision fields. This prevents duplicate IDs
  and hidden-form payloads during AI refresh. The fixed desk root uses overflow:clip; scrolling belongs to its nested areas.
  Flagged pairs offer original document/announced/manual resolution buttons and no pair-confirm action until resolved.
  A standalone missing amount uses the original amount input/save form (those flag buttons do not exist in this state).
  OCR emits `lbc:ocr` after boxes are drawn and `lbc:ocr-layout` after placement; desk SVG connectors use real boxes,
  ResizeObserver and load/animation events, with no frame loop. Missing boxes keep facts visible and draw no connector.
  The left chat peek uses the current original `.chatmsg.focus` and `S.chatState.focusIds`, expires after five seconds,
  and opens the same chat panel at that message. It makes no AI request. No routes/schema/financial rules change.
  Desk D1–D6 and browser OCR shipped 2026-10-09 in deployment `30e5acf8-c844-4c4e-9939-972d19fea1a7`
  from runtime commit `b0a2dc2`, via controlled SSD release `releases/document-desk-20261009-b0a2dc2/`.
  HTTP hashes of 35 public/Mobile files matched, with existing Mobile compiled bytes preserved; classic remains default.
  Phase 2 P1–P8 shipped on approved deployment `21b162ce-aa17-4555-8a8a-0025fcf425a3` (SUCCESS), runtime `044e082`.
  Controlled release `releases/document-desk-phase2-20261009-044e082/` preserves8Mobilecompiled files;153sourcefiles
  matchedGit,43public/MobileHTTPhashes and health/API/browser checks passed. Work branch and Production base are pushed.
  Local-only notes below describe verification fixtures; financial decisions were not executed in the Production browser. `desk-dialogs.{js,css}` preserves native overlays,
  visibility, focus return and existing source selection. Group filters proxy the original select/change listeners in day,
  board and flags (including All outside day). Original flag amount controls are moved/restored; original flag context
  guards remain active. Aggregate group connectors link total chips, with no false first-paper comparison.
  Every work item retains an explicit list escape in ⋯; normal actions stay on the desk. Orphan/Other page hints have
  no native pick-bill action today: show image/chat/original controls, never invent a write path. Unknown cash confirmer
  stays unknown because the current list API does not expose it. The original chat panel scrolls inside its left drawer
  and aligns to focus messages. The shared undo bar collapses after three seconds but keeps original undo lifetime/handler.
  Desk image viewer zoom/drag/rotate/Escape uses original cached OCR; rotated OCR is hidden, and leaving the scope closes it.
  Local desk preview: run `scripts/desk-view-preview.mjs <existing SSD preview data>` through the verified SSD runner
  with Node24; it uses SQLite backup API, copies images into the run, rewrites only copy paths, disables AI and mocks LINE.
  `scripts/desk-{view,item,review,classic}-browser-check.js` are Playwright CLI `run-code --filename` checks.
  Browser fixtures for amount flags/missing values/empty queue are memory-only; browser writes are blocked.
  Phase 2 browser checks are `desk-{shell,board-flags,complex,completed}-browser-check.js`; all output must stay on verified SSD.
  Additional checks cover board/flags source group parity, completed groups and native-form drafts via
  `desk-board-flags-group-check.js`, `desk-completed-group-browser-check.js`, `desk-native-form-browser-check.js`.
  `npm run check` syntax-checks the desk modules alongside the existing backend/Mobile checks.
- **Mobile V3 accessibility trial:** an isolated React/Vite PWA in `mobile-admin-v3/`, built to
  `mobile-admin-v3/dist` and served at `/m3`. It keeps the same API and accounting rules but uses
  larger type/touch targets, explicit action wording, progressive two-step multi-document matching,
  loading states that never flash false zero counts, and a silent user-action audit log. Its service
  worker scope is `/m3/` and financial API/image responses remain network-only.
- **AI:** OpenAI Responses API vision model (`AI_PROVIDER=openai`), or a filename-based
  fake (`AI_PROVIDER=mock`) used by tests.

```bash
npm run dev      # node --watch src/server.js
npm start        # node src/server.js
npm run mobile3:dev / mobile3:build / mobile3:test  # accessible /m3 trial frontend
npm run check    # backend checks/tests and Mobile V3 tests/build
npm run smoke    # end-to-end test with mock AI (spins up a throwaway server)
```

Local dev: copy `.env.example` → `.env`. Default `PORT=8000`. Admin UI at `/admin`.
Run `npm run preview:sync` to copy a consistent SQLite snapshot and all captured images from the
Railway volume into ignored `.local-preview/data`, then `npm run preview` and open
`http://localhost:8010/admin`. The local server uses only that copy: confirm/edit actions mutate
the local database and never reach production. Sync again whenever a fresh production snapshot is
needed; syncing replaces local preview changes. The mobile preview is `http://localhost:8010/m3/`.

`npm run audit:backfill -- --start=YYYY-MM-DD --end=YYYY-MM-DD` is dry-run by default. Add
`--apply` only against a backup/local copy first; it requeues stale false amount flags, known
marketplace/payment-voucher misclassifications, and retryable AI failures without overriding
manual category or bill-amount edits.

## 4. Environment variables

| Var | Purpose |
|---|---|
| `PORT`, `HOST` | Listen address (default 8000 / 0.0.0.0). |
| `CAPTURE_DATA_DIR` | Data root. **Production = `/data` (Railway volume).** Holds the sqlite file + `images/`. |
| `CAPTURE_DB_PATH` | Optional explicit sqlite path (default `<CAPTURE_DATA_DIR>/line-bill-capture.sqlite`). |
| `LINE_BILL_CAPTURE_CHANNEL_SECRET` | LINE webhook signature verification (HMAC-SHA256). |
| `LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token (download image content, fetch sender profiles). |
| `LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN` | Read-only token for the standalone management-accounting rounds/snapshot API. |
| `LINE_BILL_CAPTURE_SILENT_MODE` | Set `1` to block every outbound LINE push while keeping webhook ingestion, image downloads, and chat capture active. This overrides validation-group replies and explicit admin transfer pushes. |
| `LINE_BILL_CAPTURE_DOWNLOAD_MAX_ATTEMPTS` | Maximum recovery cycles for a failed LINE image download (default 5, each cycle already retries the HTTP request three times). |
| `LINE_BILL_CAPTURE_PUBLIC_BASE_URL` | Public HTTPS service origin used only to build a 15-minute HMAC-signed bill-image URL for explicit **แจ้งให้โอน** pushes. |
| `LINE_BILL_CAPTURE_PUSH_MOCK` | `1` makes explicit admin push actions record a simulated send without contacting LINE. Forced on by `npm run preview`. |
| `LINE_BILL_CAPTURE_GROUP_LABELS` | JSON map `{ "<groupId>": "ชื่อกลุ่ม" }` for display names. |
| `LINE_BILL_CAPTURE_VALIDATION_GROUPS` | JSON map of groups allowed to run a summary-cover check and receive a reply after the exact text `ตรวจบิล`; example `{ "<groupId>": { "mode": "bill_summary", "supplier": "เจ๊แววไก่สด", "reply_enabled": true } }`. Empty by default, so every group remains silent. |
| `LINE_CONTENT_MOCK_DIR` | Test-only: read image bytes from local files instead of LINE API. |
| `AI_PROVIDER` | `openai` (real) or `mock` (tests). Empty + no key = AI disabled. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_VISION_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_IMAGE_DETAIL`, `OPENAI_MAX_OUTPUT_TOKENS` | OpenAI config. Default vision model is the balanced `gpt-5.6-terra` with reasoning effort `medium`. Summary covers with many rows may need `OPENAI_MAX_OUTPUT_TOKENS` around 3000. |
| `AI_COST_USD_THB_RATE`, `AI_INPUT_USD_PER_MILLION`, `AI_CACHED_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION` | Admin-header cost estimate. Defaults use 35 THB/USD and the known `gpt-5.6-luna` standard token rates; override them when exchange rates or model pricing changes. Reasoning tokens are already included in output and are not charged twice. |
| `AI_TRACE_ENABLED` | `0` ปิดการบันทึกร่องรอยการอ่านรูปลง `<CAPTURE_DATA_DIR>/ai-trace/<วันที่>.jsonl` (ค่าเริ่มต้นเปิด). ดูด้วย `node scripts/ai-trace.mjs`. |
| `DECISION_REASON_REQUIRED` | Default `1`. Every authenticated browser mutation must include a user-action audit context. The neutral reason code is `user_action`; no reason dialog or Shadow AI call is made. Set `0` only in isolated automated tests. |
| `AI_WORKER_ENABLED` | `auto` (on if configured) / true / false. |
| `PREVIEW_AI_ENABLED` | Local-preview safety switch (default off). Set to `1` only when the copied local database should call the configured AI API. `scripts/local-preview.mjs` loads `.env` before evaluating it. |
| `AI_WORKER_INTERVAL_MS`, `AI_WORKER_START_DELAY_MS`, `AI_WORKER_BATCH_SIZE`, `AI_WORKER_MAX_ATTEMPTS`, `AI_WORKER_STALE_PROCESSING_MS`, `AI_MAX_IMAGE_BYTES` | Worker loop tuning. Attempts default to 8; transient API errors use exponential retry scheduling. |
| `AI_ANALYSIS_CONCURRENCY` | Number of vision analyses allowed concurrently inside one worker cycle (default 1, maximum 5). Keep at 1 when strict chronological image-summary context matters; local bulk reprocessing may use 3. |
| `AI_TEXT_CONTEXT_WINDOW_MS`, `AI_TEXT_CONTEXT_LIMIT` | How much nearby same-sender typed text to feed the vision model (default 30 min / 10 msgs). |
| `AI_CONVERSATION_CONTEXT_WINDOW_MS`, `AI_CONVERSATION_CONTEXT_LIMIT` | Ordered all-sender LINE group timeline sent to the vision model (default ±6 hours / nearest 15 messages). Nearby analyzed images are represented by their stored AI summaries. |
| `AI_AUTO_MATCH_ENABLED`, `AI_AUTO_MATCH_MIN_SCORE` | Create match proposals and label scores at/above this threshold as high-confidence (default 90). AI proposals still remain `pending` until a human confirms them. |
| `AI_SEQUENCE_MATCH_MIN_SCORE` | Minimum score to even propose a candidate pair (code default 50; production is set to 55). Setting it very low floods the review queue with junk candidates. |
| `AI_MATCH_AMOUNT_TOLERANCE`, `AI_MATCH_PERCENT_TOLERANCE`, `AI_MATCH_MAX_HOURS`, `AI_MATCH_REQUIRE_SAME_SOURCE` | Matching heuristics. |
| `AI_MATCH_SOURCE_FALLBACKS` | JSON map from a slip's primary group to bill groups searched only as a fallback. Cross-group fallback pairs always require human confirmation. |
| `LINE_EXPORT_SENDER_ALIASES` | Optional JSON map from imported display names to canonical LINE user IDs. Exact unambiguous live names are also repaired automatically within each group. |
| `ADMIN_AUTH_MODE` | `operator_only` in Production by user request 2026-10-05. Opens the named selector without credentials. Anyone with the URL can choose a listed name and access/edit bills. Other deployments default to credential mode when unset. |
| `ADMIN_ACCESS_TOKEN` | Legacy credential-mode private link (ignored in operator-only mode). Random value with at least 24 characters. Never commit it. |
| `ADMIN_OPERATOR_NAMES` | JSON array or comma-separated selector names; required in operator-only mode. Production retains the existing four names and adds `dot`. The signed selected-name cookie is reused across `/admin` and `/m3` and audit fields. Names are self-selected labels, not identity verification or different permissions. |
| `ADMIN_PIN` | Legacy credential mode only; ignored in operator-only mode. Production PIN cleared by user request 2026-10-05. |
| `ADMIN_AUTH_DISABLED` | Local-only bypass. It is honored only when `HOST` is loopback; `npm run preview` sets it automatically. |
| `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_HOURS`, `ADMIN_MAX_FAILS`, `ADMIN_LOCK_MINUTES` | Session key (random per boot if unset), session length, and the login rate limit. |

Secrets are never committed. `.env` and `.env.*` are in `.gitignore` and `.dockerignore`.

## 5. Data model (SQLite tables)

- **`capture_items`** — one row per received image (bill or slip). The core table.
- **`capture_matches`** — a bill↔slip pairing with score/status/reasons.
  Rows sharing `match_group_key` form one aggregate transaction, allowing one bill paid by
  several slips or several bills paid by one slip. Aggregate totals must deduplicate member IDs.
  Human-created aggregate transactions have no fixed 20-document cap; their rows form a sparse
  connected graph so large groups do not grow as bill-count multiplied by slip-count.
- **`capture_cash_payments`** — human-confirmed full cash payment for one bill. Stores the
  server-derived bill amount/business date, required recipient/note, actor/timestamps, and an
  auditable `confirmed` or `voided` status. There is at most one active cash payment per bill.
- **`ai_learning_examples`** — owner-approved confirmed/rejected pair examples. These are injected
  into later vision prompts as operational hints; they are not external model fine-tuning.
- **`ai_category_learning_examples`** — owner-approved category corrections. Before an image is
  moved to `other`, the AI reviews the image plus the typed reason, acknowledges a concrete rule,
  or asks one clarification question when the reason is vague. Accepted examples are injected into
  later vision prompts alongside pair examples; this is in-context learning, not model fine-tuning.
- **`capture_daily_closings`** — per (business_date, source_id) daily close record + summary snapshot.
  Snapshot version 5 stores incoming transfers, their count, and their total separately from
  expense/payment reconciliation. Reports show income but never net it against expenses.
  Startup repairs legacy closed snapshots that placed a cross-day match on the bill date; the
  repaired source and destination snapshots both follow the slip/transfer date.
- **`line_messages`** — every chat message (text/image/etc). Text messages are the source of the "typed context".
- **`line_senders`** — per-group sender profile (display name, picture) from LINE.
- **`line_groups`** — known groups + counts.
- **`line_events`** — raw webhook event log (idempotency via `webhook_event_id`).
- **`line_group_validation_requests`** — one-shot `ตรวจบิล` requests; a request is replied only after the configured group's summary cover and detail bill amounts match.
- **`line_transfer_requests`** — audit trail for each explicit admin **แจ้งให้โอน** action. Status is `sent`, `mock_sent`, or `failed`; stores the bill, target group, exact message, actor, and timestamps.
  `includes_image` and `image_item_id` prove which bill image was sent with the text.
- **`decision_events`** — silent user-action audit records containing operator, timestamp, page,
  action/entity, request snapshot, route, HTTP result, and completion status. Legacy reason/evidence
  columns remain readable for historical records.
- **`shadow_predictions`**, **`decision_followups`** — legacy history tables only. The application
  no longer reads or writes them; they remain solely to avoid destructive data removal.

### Key `capture_items` columns & enums

- `category`: `pending` | `bill` | `bill_page` | `transfer` | `transfer_notice` | `incoming_transfer` | `payment_voucher` | `other`  (transfer/transfer_notice = "slip"). `payment_voucher` is retained only for legacy compatibility; a newly read ใบสำคัญจ่าย is `category='bill'` with `document_class='payment_voucher'`.
- `status`: `received` | `downloaded` | `download_failed` | `unsent` | `duplicate`
- `match_status`: `unmatched` | `pending` | `manual_review` | `confirmed` | `rejected` | `needs_amount`
- `ai_status`: `pending` | `processing` | `done` | `failed`
- `bill_total_value` / `slip_amount_value` — numeric amounts (from image OCR, or typed text for bills).
- `supplier_name` — canonical supplier name extracted from the current summary cover; detail-bill OCR names never overwrite it.
- `document_class` in `ai_result_json`: `bill_summary_cover` (the source-of-truth cover), `bill_summary` (an aggregate/cash-sale summary that must not count as a detail bill), `standard_bill`, `bill_continuation`, `transfer_slip`, `incoming_transfer`, `payment_voucher`, or `other`.
- `announced_amount` — numeric amount explicitly typed in nearby chat for a bill, kept separately from the document/OCR amount.
- `context_message_id`, `context_link_method`, `context_link_confidence`, `context_link_reason` — audited link from a bill to the exact typed announcement selected after AI reading. The normal workflow is image first, then immediate same-sender details: the first meaningful post-image text wins and the next same-sender image closes that context window. Prior text is an exact-agreement fallback only, so the previous bill's announcement cannot leak into the next image.
- `bill_purpose` — what a bill is FOR, from the chat announcement (e.g. "ค่าเนื้อ", "ค่าผัก"). Bills only.
- `payment_role`: `ordinary_payment` | `advance_payment` | `reimbursement`. The latter two describe
  an employee/person paying a business expense first and Solao repaying that person.
  **Jum is the shop owner and primary authorized payer**, so an image submitted by Jum starts as a
  normal owner/business payment, not an employee advance. Sender identity is supporting context only:
  the slip's visible from/to accounts and explicit chat wording still determine payment direction and role.
  **J. is purchasing/accounting for both LINE groups** and normally submits bills, document details,
  and requests/notices for payment. J.'s daily market reconciliation asks Jum to replenish the market
  account; its `โอนเพิ่ม` amount is expected funding, not completed-transfer evidence. A later bank
  slip or explicit completion proof is still required.
  Known participant context: 🧸🦋คาราเมล🦋🧸 is the San Kamphaeng cashier and mainly
  submits front-counter cash-intake evidence outside supplier matching; นะโม นะครับ is the managing
  director/system owner and may occasionally advance expenses; JPuN manages Kanklong;
  💖Saa.💵Roongthip🎋🔮 manages San Kamphaeng; pen pen is an owner without payment control;
  Coco Cola purchases market goods; nungning is general staff. These roles are context only and
  must never override the visible image, immediate typed details, or bank-account direction.
  The canonical role registry and dated production-learning snapshot live in
  [`docs/AI_LEARNING_STATUS.md`](docs/AI_LEARNING_STATUS.md); update that file whenever the owner
  corrects a participant role or a new quality audit is taken.
- `reimbursement_related_item_id` links the advance-payment slip and reimbursement slip in both
  directions. `reimbursement_status` is `unmatched` or `pending`; AI-created links wait for review.
  `reimbursement_reason_json` records the amount/purpose/time evidence.
- `reimbursement_status` can become `confirmed` after review. `reimbursement_evidence_mode` is
  `existing_receipt`, `receipt_substitute`, or `not_required`; the last option requires a stored
  `reimbursement_review_note`. Reviewer and timestamp are stored in `reimbursement_reviewed_by` /
  `reimbursement_reviewed_at`.
- `amount_review_flag` (0/1) — set when the amount typed in chat disagrees with the amount on the document. Every pair requires human confirmation; a flagged pair additionally blocks confirmation until the flag is resolved. The desktop review shows the original AI-read document amount, announced chat amount, and transfer amount separately; a later manual bill edit must not make a flagged pair look like an ordinary exact match.
- `flag_resolved_at` / `flag_resolved_by` — audit fields written when an admin clears an amount flag, including when the announced amount is applied to the bill.
  The desktop pair review must show the three explicit resolution paths beside the warning: keep the
  original AI-read document amount, use the announced chat amount, or enter a checked amount. Resolving
  a flag never confirms the pair automatically; the human must inspect both images and confirm separately.
- `category_edited_at` / `category_edited_by` — records a human category correction. Full AI resets preserve these owner-taught examples.
- Re-analysis may replace any earlier AI-assigned category, including `other`; only rows with
  `category_edited_at` are protected from AI category changes.
- Admin-generated documents (`generated_document_type` is set) are already structured data, not
  vision inputs. Full reset, targeted requeue, and pause/resume exclude them; startup repairs any
  legacy generated row left in `pending`/`processing`/`failed` back to `ai_status='done'`.
- `category_edit_reason` — the admin's typed explanation for a manual category correction such as **ไม่ใช่บิล** / **ไม่ใช่สลิป**.
- `doc_ref` / `page_no` / `page_count` — multi-page invoices. `doc_ref` is the tax invoice number,
  printed identically on every page. Page association additionally requires the same source type/group
  and reliable supplier identity: equal tax IDs when both are present, otherwise equal normalized
  vendor/supplier names. A missing identity leaves the page in review; a reference alone never proves
  a shared invoice. Item list/context expose `document_has_payable` and `document_related_ids_json`;
  the desktop hydrates those related IDs across date boundaries for page previews and orphan buckets.
- `vendor_tax_id` — normalized 13-digit tax ID printed on a bill. It is used with `doc_ref` and
  the payable amount to detect the same invoice sent again even when the image bytes differ.
- `duplicate_of_item_id` — points to the first identical image (dedup by `file_sha256`).
- `download_attempt_count` — failed download cycles. `download_failed` rows remain retryable until
  `LINE_BILL_CAPTURE_DOWNLOAD_MAX_ATTEMPTS`; LINE unsend always wins over a late download result.
- `event_timestamp_ms` — LINE event time (ms). Basis for the business date (see §7).
- `ai_input_tokens` / `ai_cached_input_tokens` / `ai_output_tokens` /
  `ai_reasoning_tokens` / `ai_total_tokens` — usage returned by OpenAI for that image analysis.
  Older rows remain null; `/api/admin/ai/status` reports aggregate tracked usage under
  `queue.token_usage`. Do not estimate monetary cost without an explicit model price.
- `ai_error_kind` / `ai_next_retry_at` — separates transient API failures from permanent/storage failures and schedules bounded exponential retries.
- Transfer-slip AI results keep `payer_account_name`, `payer_bank`, and `payer_account_masked`
  inside `ai_result_json`. The account value is always masked; a full number read from an image is
  reduced to its final four digits before it can reach the accounting export. Legacy results are
  derived from the OCR text's `จาก` / `FROM` section when possible.
- Transfer-slip AI results also keep additive `recipient_name`, `recipient_bank`,
  `recipient_account_masked`, `recipient_identifier_type`, `recipient_identity_token`,
  `recipient_confidence`, `recipient_review_status`, `recipient_evidence`, and
  `recipient_provenance` fields for the `ไปยัง` / `TO` side. These fields are derived only from
  role-labelled recipient evidence or stored OCR; bill supplier/payee fields and `payer_*` are
  never copied into them. A masked account is display evidence only, so its identity token stays
  null and the downstream accounting Inbox keeps the recipient in `REVIEW_REQUIRED` scope.
- `line_senders.canonical_user_id` — maps imported pseudo identities back to the matching live LINE sender without rewriting message provenance.
- `generated_document_type` / `generated_document_json` / `generated_from_item_id` — audit data
  for an admin-created document. `receipt_substitute` is a bill generated from one unmatched slip;
  the JSON stores payer, payee, destination account, description, date, amount, and document number.
  `batch_payment_summary` marks a source image containing several supplier payments, while each
  payable row becomes a generated `batch_payment_line` bill linked back through
  `generated_from_item_id`. Excluded/handwritten "จัดรวม" rows stay only in the parent JSON and
  are not counted as payable items.
- A match can store `review_note`, `ai_learning_approved`, `reviewed_by`, and `reviewed_at`.
  Approval requires a non-empty note and creates/updates one `ai_learning_examples` row per match.
- One bill or slip may belong to only one active transaction (`pending`, `manual_review`, or
  `confirmed`). A multi-bill/multi-slip transaction may repeat a member across its internal edge
  rows only when those rows share one `match_group_key`. Manual reassignment is rejected with
  `document_already_used` unless the caller explicitly sends `replace_existing: true`; the UI must
  show a destructive replacement confirmation before sending that flag.

## 6. Core flows

1. **Ingest:** `POST /webhook` → verify LINE signature → durably insert every raw event/message
   and every image's `capture_items(status='received')` metadata → respond 200 → `processEvents`
   (setImmediate). A pre-ack database failure returns 500 so LINE can redeliver; never move the
   200 response ahead of durable metadata writes. Image messages then download bytes
   (dedup by sha256) → `capture_items` with `status='downloaded'`. New files use content-addressed
   `images/blobs/<prefix>/<sha256>.<ext>` storage. Byte-identical images are deduplicated only
   within the same LINE group; cross-group resends remain independent evidence rows while sharing
   the immutable blob. An unsend deletes the blob only when no live item still references it.
   Text messages → `line_messages`.
   Each download cycle retries three times. On startup and every recovery interval, the service
   scans both `status='received'` rows and retryable `download_failed` rows, then resumes their
   downloads from `raw_event_json`, covering a crash or a temporary LINE content error after
   acknowledgement. Failed cycles increment `download_attempt_count` and stop at the configured
   maximum. If the canonical copy of a byte-identical image is unsent, the oldest still-active
   duplicate is promoted and retains the stored evidence instead of deleting a file that is still
   represented by another LINE message.
   `/health` exposes `ingest.last_event_at`, event count, pending downloads, failed downloads, and
   a 60-day ingest-completeness scan. The scan detects an internal multi-day silence when another
   known LINE group remains active for most of the same dates. Admin UI must show a deterministic
   warning only: it may recommend checking a LINE export, but it must never invent missing messages,
   images, amounts, or automatically mark the range complete.
   If an old webhook gap must be recovered, `scripts/import-line-chat-export.mjs` imports a LINE
   desktop text export plus an exactly ordered image directory. The parser discovers sender names
   from media markers before parsing text, because a fixed sender allow-list silently drops both
   images and their surrounding conversation when a member changes or adds a display name. It
   creates stable synthetic event,
   message, and sender IDs, so rerunning the same date range is idempotent. Expired LINE media may
   be recovered from the desktop viewer thumbnails. Use
   `scripts/process-line-thumbnail-captures.mjs` to remove the LINE viewer chrome and upscale the
   real thumbnail with Lanczos/sharpening; do not use generative enhancement that could fabricate
   document text. Recovered media must be labeled in `raw_event_json.import`
   as `expired_line_desktop_thumbnail`; it remains real evidence at reduced quality and enters the
   normal AI queue. The importer creates a consistent SQLite backup before writing and never sends
   or replies to LINE.
2. **AI worker** (`ai-worker.js`, runs on an interval): claim `downloaded`+`ai_status=pending`
   items → gather **nearby typed text** from the same sender (`listNearbyText`) plus an ordered
   all-sender group timeline (`listNearbyConversation`) → send image + both contexts to the vision
   model (`buildVisionPrompt`) → apply deterministic corrections for known high-signal formats
   (a daily market sheet uses the typed `จ่าย` amount and adjusted `โอนเพิ่ม`; an
   older daily-market analysis labeled `แบบสรุปยอดปิดตลาด` is repaired from the same chat pattern
   at startup even when its saved `bill_purpose` is empty; an
   e-commerce order-detail page with shop, order number, and final payable total remains a bill even
   before payment) → `applyAiAnalysis` writes category,
   amounts, then deterministically binds a bill announcement using the image-first workflow,
   same-sender direction, the next-image boundary, explicit amount keywords, and visual agreement. The exact context message and
   confidence are stored; an unrelated previous amount cannot create a false flag. Known order
   pages and incoming transfers are corrected before persistence. A ใบสำคัญจ่าย / PAYMENT VOUCHER
   is treated as the bill-side expense document while retaining `document_class='payment_voucher'`;
   legacy AI-only voucher categories are repaired the same way at startup. It writes
   `announced_amount`, `bill_purpose`, `amount_review_flag`, etc. → `autoMatchAiPairs` proposes/creates
   matches.
   While **อ่านใหม่รอบนี้** is running, the desktop admin polls AI status every two seconds and
   refreshes the open day whenever progress changes (or at least every six seconds). Each completed
   image therefore leaves `AI กำลังอ่าน` and appears in its bill/slip/review/other bucket without
   waiting for the whole global queue to finish or requiring a manual reload.
   For groups listed in `LINE_BILL_CAPTURE_VALIDATION_GROUPS`, the worker treats the first image in the current cycle as a source-of-truth `ใบรับวางบิล` / summary cover, takes the canonical supplier name from that cover, then accepts supplier-specific detail formats (receipt, invoice, delivery note, handwritten form, cash sale). Aggregate/cash-sale summaries are kept as evidence but excluded from the detail count. It matches cover rows by document reference when both sides have one, then uses amount/date, then amount-only fallback. Duplicate amounts remain separate rows. It only sends a LINE message when a user has first typed exactly `ตรวจบิล`, the counts, duplicate amounts, and totals all match, and `LINE_BILL_CAPTURE_SILENT_MODE` is not enabled. Silent mode is a hard outbound guard and does not stop capture. An incomplete AI result or mismatch produces no LINE message.
   **Context and reconciliation invariants (2026-10-03):** use the same structural
   `isDailyMarketSheetVisual` predicate for deterministic correction and context binding;
   generic chat binding must preserve the market reconciliation. Both provider branches pass
   the current item to the known-transfer guard. `chat-evidence.js` shares image-boundary and
   market reconciliation rules with late-message binding and startup repairs. Crossing another image from the bill's sender
   requires a shared document reference or explicit batch wording; another sender's image does not
   end the bill owner's context; proximity
   and equal amounts alone do not establish a batch. The worker reads all immediate image boundaries
   separately from the truncated model conversation so a busy chat cannot silently remove them.
   For market sheets, `announced_amount` is the daily spend minus signed shortage/excess;
   `ai_result_json.market_reconciliation` retains the literal top-up, balance, and combined wording.
   Multiple explicitly dated daily sections in one message are calculated independently; the
   stored metadata records whether their sum reconciles to the combined top-up.
   A combined top-up without daily reconciliation stays unallocated (`announced_amount=null`,
   `needs_review=true`) and cannot automatically match by falling back to spend. Startup market
   repair uses the same calculation and preserves human amount/category edits. AI persistence uses
   the effective manually protected category/amount for state transitions (including continuation
   pages), flags, and match compatibility rather than the unprotected AI output.
3. **Matching** (`scoreSequencePair`): amount is the first gate. A bill/slip pair outside both
   amount tolerances is not a candidate regardless of time proximity. Remaining candidates score
   amount closeness + same group + time gap + AI confidence + identity/reference evidence.
   `>= AI_SEQUENCE_MATCH_MIN_SCORE` → candidate. Every AI-created candidate is `pending`, including
   exact same-source pairs above `AI_AUTO_MATCH_MIN_SCORE`; only an authenticated human action may
   set `confirmed`. Exact candidates are ordered before non-exact candidates. A higher-scoring AI pending pair may replace a lower machine-only
   pending pair, but AI can never replace a confirmed pair or a human-confirmed/rejected decision.
   Every match update synchronizes both items atomically; startup reconciliation repairs legacy
   rows whose `match_status` or `matched_item_id` disagrees with the active match record. Before
   rejection, reassignment, unsend, metadata edits, or invalid-match repair, the service captures
   the affected active transaction anchors and reopens their bill-owner rounds atomically; grouped
   transactions use the original earliest slip before mutation. Historical closing snapshots and
   closed/reopened audit fields remain available.
   Before matching, semantic duplicate bills are checked using the same LINE group, normalized
   `doc_ref`, payable amount, and vendor tax ID/vendor name. A later matching bill is marked
   `status='duplicate'`, points to the first bill via `duplicate_of_item_id`, and cannot be
   auto-matched. Existing matches on that duplicate are rejected and the slip is released for
   review. This is separate from byte-level SHA-256 duplicate detection because LINE may resize
   or recompress a resent image.
   Optional source fallbacks are a guarded second pass. A cross-group candidate must have an exact
   amount within `AI_MATCH_AMOUNT_TOLERANCE` or a trusted reference, and it is always created as
   `pending`, never auto-confirmed. The local workflow maps slips from **สันกำแพง** to
   **คันคลอง** as the fallback bill group.
   Before normal bill↔slip matching, `autoLinkAdvanceReimbursements` detects an explicit company
   reimbursement and searches backward in the same group for a person-paid transfer with the exact
   amount and overlapping expense-purpose words. It links the two transfers as a pending
   reimbursement chain. A reimbursement is never bill-matched; an advance-payment slip may only
   enter normal matching when the bill amount is exact within `AI_MATCH_AMOUNT_TOLERANCE`, preventing
   a nearby but unrelated amount from being proposed.
   Admins can manually combine up to 20 bills and 20 slips through
   `POST /api/admin/match-groups`. The service records a connected set of match rows under one
   `match_group_key`, releases conflicting prior matches, and moves every member through pending,
   confirmed, or rejected together. The review UI compares the sum of unique bill members with
   the sum of unique slip members before the group is confirmed.
   `POST /api/admin/items/:id/split-batch-payment` handles a supplier payment summary: it keeps the
   original image as `batch_payment_summary`, creates one independent `batch_payment_line` bill per
   payable supplier, and places those children in the dedicated **รอบจ่ายหลายรายการ** queue. Each
   child can then match one or several slips; the parent total is a reconciliation control only.
   A bill may instead be closed as **จ่ายเงินสด** through
   `POST /api/admin/items/:id/cash-payment`. Only a human admin can do this: the server derives the
   full amount and Bangkok business date from the bill, requires recipient + note, and refuses any
   bill with an amount flag, missing amount, or active bill↔slip match. No fake slip is created and
   no LINE message is sent. Cash confirmation sets the bill item to `match_status='confirmed'`;
   matching code rejects it until the cash record is voided. Editing bill amount/category,
   duplicate/unsend handling, or an explicit void invalidates the active cash record and returns
   the bill to the appropriate queue. AI reset preserves human-confirmed cash payments.
4. **Admin review** (`/admin`): the home screen is a monthly operations dashboard with
   previous/current/next month navigation. It shows four workload totals, a full-width 7-column
   calendar, and a detailed round table sorted with open/high-workload rounds first.
   Review workload is counted as transactions (`pending_count`, including `manual_review`),
   with unique bill/slip membership separately exposed as `pending_document_count`. Pending
   matches use the same earliest-slip date and owner group as `/api/admin/matches`, including
   a board row when that group has no image on the anchor date. A group containing bills from
   different sources belongs to its earliest bill's group, matching closing snapshots; filtering
   by that owner returns the entire group, never a partial set of edges. Unmatched images retain their
   upload date. Board and closing workload include `processing_count` (download wait/failure,
   AI pending/processing/failed/paused); the board shows waiting, failed, and paused AI counts.
   `/api/admin/days.unresolved_count` equals review transactions + unmatched documents + missing
   amounts + processing images. `scripts/pipeline-board-regression-test.mjs` verifies the composed
   AI/persistence flow and DB/API/board/closing contract with an isolated fictional SQLite database.
   Work identities are typed (`transaction`, `transaction-group`, `reimbursement`, `item`) so
   independent table IDs never collapse. The same capture item in multiple item buckets counts once;
   a pending transaction and a pending image-analysis task remain distinct. Match mutation responses
   include `transaction_business_date`, `transaction_source_id`, and `bill_source_id`; item context includes `active_transaction`
   for navigation from the original upload day. Reverse pairing and chat process links open the
   transaction anchor day in the owning bill group, including confirmed/grouped transactions.
   `scripts/branch-state-regression-test.mjs` covers branch/vendor identity, cross-date document
   hydration, concurrent senders, typed work counts, navigation, protected AI fields, and closing
   invalidation/startup repair on fictional data.
   Every calendar date lists its LINE groups separately with `ค้าง`, `พร้อม`, or `ปิดแล้ว`, so selecting a group
   opens that exact date and LINE group. The entire date cell is also actionable: a populated date
   opens its highest-workload group, while an empty date opens the currently filtered group or the
   first known group. Calendar colors mean `ปิดรอบครบ`, `พร้อมปิด`,
   `ยังมีงานค้าง`, or `ค้างเกิน 8 วัน`. From there, use the left LINE chat timeline
   for context while selecting a bucket/item and acting in the right workspace → confirm / reject /
   change slip / edit bill fields → **close the day** (snapshot). A closed day exposes
   **พิมพ์สรุปรอบ**, which builds an A4 print report entirely from the closing snapshot and the
   locally loaded evidence: page 1 is the daily financial reconciliation (bill total, transfer
   total, variance, an itemized confirmed-bill list, and sign-off lines), followed by one A4
   evidence page per confirmed transaction with its bill, slip, document pages, or generated
   receipt substitute.
   The desktop day header has previous/next calendar-day controls. They retain the current LINE
   group and work bucket, reset the selected item, and update the URL to the newly opened date.
   Confirmed reimbursement chains are included as separate evidence pages but explicitly excluded
   from duplicate expense totals. The
   bill/slip previews and chat images open in one full-screen viewer with zoom-out, reset, zoom-in,
   mouse-wheel zoom, and scroll-to-pan at magnifications above 100%.
   The chat timeline places **วันก่อน** above its first message and **วันถัดไป**
   below its last message, so the load action appears naturally when the user scrolls to either
   edge. These prepend/append the adjacent calendar day's complete group timeline without changing
   the selected work day or replacing the current chat. Prepending preserves the visible message
   position; appending leaves the reader at the old boundary. Loaded calendar days render as
   alternating blue and white full-width bands for clear boundaries while scrolling. A small
   translucent sticky date indicator at the top of the chat updates to the calendar-day band
   currently crossing the top reading edge.
   `/api/admin/messages` accepts `date` or `start`/`end` filters.
   Reimbursement chains appear once in **รอตรวจ**, never as two **สลิปไม่เข้าคู่** rows. Their
   review shows both transfer images and requires an evidence decision: use an already-confirmed
   bill/receipt, create a receipt substitute from the advance-payment slip, or explicitly record
   why no substitute is required. `POST /api/admin/reimbursements/:id/review` stores the decision;
   AI never confirms it automatically. Once confirmed, the reimbursement transfer remains
   item-level `match_status='unmatched'` because it is not a bill pair, but the daily closing and
   live leftover counters must exclude it from **สลิปไม่เข้าคู่**.
   Opening an item loads the complete Bangkok calendar day for that LINE group, not only the
   item's ±6-hour AI context window. The shorter context window remains an AI prompt concern and
   must not hide same-day messages from the human chat timeline.
   This is used when a bill announcement and its payment slip cross midnight.
   Confirmed transfer slips are collapsed in the chat timeline and labelled with their matched
   bill. An unmatched slip can be closed with **สร้างใบแทนใบเสร็จรับเงิน**: the payer is fixed to
   `บริษัท โซลาว จำกัด`, payee/account are suggested from the slip destination, the admin must
   enter the expense detail, and the generated bill is immediately confirmed against that slip.
   Every captured image in the LINE chat has a small process-location button labelled with its
   current bucket. Clicking it switches to that bucket, selects the exact item or pending pair,
   and navigates to the bill's date first when the pair crosses days.
   The work queue always shows the selected position as `n/N`. **ข้ามไว้ก่อน** advances to the
   next row without writing to the database. Unconfirmed items expose explicit **นี่คือบิล** /
   **นี่คือสลิป** category corrections; existing **ไม่ใช่บิล** / **ไม่ใช่สลิป** actions still
   require a reason. Confirm, reject, and category corrections expose an eight-second **ย้อนกลับ**
   action. Confirmed pairs in **เสร็จแล้ว** have **ยกเลิกการยืนยัน**, guarded by a confirmation
   dialog, which returns the pair to `pending`; that decision can also be undone immediately.
   Keep only one startup data loader: the route-aware initializer must apply `?date=&group=` before
   loading items. A second unscoped initializer races and can replace a direct day URL with the
   selected group's entire history.
   The **เสร็จแล้ว** bucket is pair-oriented: each queue entry shows both bill and slip
   thumbnails, and its detail workspace renders the two full documents side by side with amounts,
   timing, group, sender, and LINE timestamps.
   It also contains human-confirmed cash bills and has `ทั้งหมด` / `โอน` / `เงินสด` filters on
   both desktop and mobile. A cash detail shows the bill plus cash evidence (recipient, note,
   amount, confirmation time) and permits editing or audited voiding. Day-close snapshots use
   `snapshot_version=3`, merge bank-transfer and cash transactions, and report transfer/cash totals
   separately while comparing total expenses against total payments.
   Legacy items whose item-level `match_status` is still `rejected` are shown in the unmatched
   bill/slip bucket; rejection means they are available to pair again, not hidden from the process.
   The endpoint is idempotent by source slip, so submitting twice cannot create duplicate documents.
   Rejecting a proposed pair keeps the `capture_matches` row as `rejected` for audit, but clears
   both items' `matched_item_id` and returns their `match_status` to `unmatched`, so each document
   is immediately available for a different pairing.
   An unmatched slip also exposes **เลือกบิลที่เกี่ยวข้อง**. Its reverse picker queries up to 1000
   unmatched bills from every date in the same LINE group first, then exposes configured fallback
   groups when no exact primary-group bill is found. It ranks both sections by amount/time and
   marks fallback candidates as cross-group. Every manual cross-group choice creates a `pending`
   pair for human confirmation. For a cross-date choice the UI navigates to the bill's
   business date; the normal day data pool spans ±31 days so both previews remain available.
   Both unmatched document views expose a direct correction: **ไม่ใช่บิล** or **ไม่ใช่สลิป**.
   The UI requires a typed reason before confirming. This changes the category to `other`
   through the normal category endpoint, records `category_edit_reason` plus
   `category_edited_at/by`, removes any active pairing, and survives later full AI resets.
   An unmatched bill also exposes **แจ้งให้โอน**. It opens a review sheet showing the target group,
   full bill preview, amount, and editable text. The admin must tick a confirmation after the last
   edit; the API also requires the preview item ID and explicit confirmation marker. One push sends
   the bill image followed by the confirmed text to that bill's original LINE group through
   `POST /api/admin/items/:id/request-transfer`. LINE fetches the image from a public 15-minute
   HMAC-signed media URL; all ordinary image APIs remain authenticated. This is an explicit admin action, never an
   automatic bot reply. Local preview forces `LINE_BILL_CAPTURE_PUSH_MOCK=1`, so it records
   `mock_sent` without contacting LINE.
   Before confirming or rejecting, the admin may add a pair note and explicitly opt in to
   **บันทึกเป็นตัวอย่างให้ AI**. Only opted-in notes become learning examples; normal review notes
   remain audit metadata and do not enter the AI prompt.
   bill item ID; pending/unmatched slips stay expanded so unfinished work remains visible.
   The
   `ต้องตรวจยอด` view lists every unresolved amount conflict, including bills that have no
   match yet; its drawer can edit the bill amount, apply `announced_amount`, clear the flag,
   and then return to the day queue for pairing.

### Typed-text semantics (important domain rule)
- The broader conversation timeline preserves speaker identity and message order and includes the
  category/amount/summary of nearby images already analyzed. It helps interpret references such as
  “อันนี้”, “โอนเพิ่ม”, and a bill followed later by its slip. Proximity alone never proves a pair;
  amount, identity, reference, or an explicit message must still support the decision.
- **Slips rarely have accompanying text** — read the slip amount from the image only; do not
  infer it from unrelated chat numbers.
- A person-paid slip followed by an explicit `คืนเงินสำรอง` transfer from Solao is one expense
  chain, not a bill↔slip pair. Require the same group, exact amount, matching expense purpose, and
  chronological order. Store the first as `advance_payment`, the second as `reimbursement`, and
  keep the AI relationship pending for human review. Do not match either to a merely near amount.
- **Bills DO get an announcement** — the person posting the bill types what it's for and the
  amount (e.g. "ค่าเนื้อ 3,276"). Use it to fill `bill_purpose` and to fill/confirm the bill
  amount. If the typed amount and the image total disagree → set `amount_review_flag` (keep the
  image total, flag for human review).
- A sheet headed `ตลาดสด` with a document date and a purchased-item table is a daily market bill.
  Name it `บิลตลาด <document date>`. In its companion message, `จ่าย` is the bill total. Calculate
  the daily expected transfer by adjusting `จ่าย` with `เงินในบัญชีขาดเกิน` (subtract positive
  excess, add shortage), and store that result as `announced_amount`. `โอนเพิ่ม` may combine several
  consecutive days; allocate its component amounts back to the relevant daily bills when their sum
  reconciles. Example: 13,985 - 1 = 13,984 and 15,142 - 29 = 15,113; together they equal 29,097.
  The literal prefix `บิลตลาด` is required in `bill_purpose`. Production data contains sheets the
  model named only `ตลาด`, which silently disabled the entire market path (adjustment + matching),
  so `isMarketSheet()` in `ai-worker.js` also accepts `ตลาด` / `ตลาดสด` and a market-sounding
  `ai_summary`. Keep both the prompt rule and that tolerant check in sync.
  `applyDeterministicChatRules()` also corrects a visually market-like image that vision labels
  as `other` when its nearby same-sender message contains `ตลาด`, `จ่าย`, and `โอนเพิ่ม`. It stores
  `จ่าย` as the bill total and `โอนเพิ่ม` as the slip-facing `announced_amount`; this rule is
  deliberately based on document/chat evidence, not merely the identities of the bill and slip senders.
  This explained difference is not an OCR conflict. A market sheet can be treated as a complete bill
  from its typed reconciliation even when the photographed form says page 1/2; do not leave it in
  `bill_page` / `ขาดหน้ายอด` for that reason alone.

### What is not a slip (explicit feedback rule)
- A Lazada/Shopee/marketplace order-detail or checkout screen is a `bill` when it shows the shop,
  purchased item, order number, and final amount due, even if it still says `ชำระเงิน`, shows a
  countdown, or uses QR/PromptPay as the selected method. A QR-only instruction screen remains
  `other`; the separate successful payment receipt is the matching slip.
- Shopee order screens are usually orange and show labels such as `รายละเอียดคำสั่งซื้อ`,
  `ร้านแนะนำ`, `รวมคำสั่งซื้อ`, and `ชำระเงิน`; use the labels and layout together, never color alone.
  Keep the actual shop as `vendor_name`, prefix `bill_purpose` with `Shopee -`, and recognize
  `ชำระสินค้า Shopee` / Biller ID `010753600031501` as the corresponding payment-slip identity.
- A photo of a merchant/POS/cashier application, sales dashboard, QR receiving screen, or customer
  payment list is `category='other'`. It may display an amount and "paid", but it proves a customer
  paid the merchant; it is not evidence that the business transferred money to a supplier. Example:
  an image of the K SHOP merchant app is `other`, never `transfer`.
- An image that merely gives a bank account/PromptPay number, payee name, or asks the recipient to
  send a slip after paying is also `category='other'`, never `transfer_notice`. It is payment
  instruction, not confirmation that a transfer occurred.
- Daily cashier settlement, cash handover, sales reconciliation, or money-remittance summary forms
  are `category='other'`, even if a bank receipt is included in the same photo. They reconcile store
  operations and must not be matched as a supplier-payment slip.
- A screenshot or photograph of a chat conversation is `category='other'`, even if a message says
  money was paid/received. Chat text is discussion context rather than a bank payment receipt.
- An incoming-credit alert (`เงินเข้า`, `เงินโอนเข้า`, `received`, or a positive amount entering this
  business's account) is `category='other'`. It records money received, not a supplier payment, and
  must never be matched to a purchase bill.
- Apply the direction check to e-Slips too: when a customer is the sender and this business is the
  recipient, it is `category='other'`. In this deployment, `ถึง บริษัท โซลาว` / `to Solao` identifies
  customer money received, not a supplier-payment slip.
- `บจก. โซลาว` / `บริษัท โซลาว` / `Solao` is **our company**. When it appears under `จาก` / `from`,
  the company is transferring money out. When it appears under `ไปยัง` / `ถึง` / `to`, the company
  is receiving money, so the image is not a supplier-payment slip.
- The account held by `น.ส. ศิริลักษณ์ เวียงแสง` (OCR may shorten it to `ศิริลัก`) ending `7193`
  is the designated **ตลาดสด expense account**. A completed transfer from `บจก. โซลาว` to this
  account is business funding for market expenses, so it is `category='transfer'` and remains
  eligible for bill matching. It is not customer revenue. An account-detail or payment-instruction
  image without proof of a completed transfer remains `category='other'`.
  Payment for a daily market sheet is normally sent to this account, so `scoreSequencePair` adds an
  identity bonus (12, same weight as the water-authority match) when a `บิลตลาด` bill with a
  positive `announced_amount` meets a slip whose OCR text shows this account. The account also
  receives unrelated transfers, so the bonus never fires on the account alone — the adjusted daily
  transfer amount still has to agree.
- A `payment_role='reimbursement'` slip enters `scoreSequencePair` only when `isMarketAccountReimbursement`
  is true (reimbursements to anyone else return `null`). It is true when the slip shows the market
  account (`7193` / `ศิริลักษณ์` / `เวียงแสง`) **and** either (a) the wording says "คืน…ตลาด"
  (`คืนเงินบัญชีตลาด`, `คืนเงินเข้าบัญชีตลาด`, `โอนคืนบัญชีตลาด`, `โอนคืนตลาด`, `คืนตลาด`, also checked in
  `ai_result_json.evidence`) or "บัญชีตลาด…สำรองจ่าย", or (b) `ai_result_json` structurally says payer
  `โซลาว`/`SOLAO` → recipient ending `7193` or named `ศิริลักษณ์`/`เวียงแสง`, regardless of AI wording.
  Wording must have "คืน" before "ตลาด". The pair still goes to a human (incl. identity-conflict reason).
- When an admin recategorises an item into a non-matchable category (anything other than `bill`,
  `transfer`, or `transfer_notice`), every active pair containing that item is rejected and both
  items return to `unmatched`; never leave a stale pair behind.

### Cross-day transfers (โอนข้ามวัน) — common, ~33% of production matches
A bill posted on day X is often paid by a slip on day X+1 (the matcher allows `AI_MATCH_MAX_HOURS`,
default 48h, so it pairs them at ~85 → **pending**, i.e. a human reviews it).

- **A paired transaction belongs to the SLIP's day** (the actual transfer date), even when its
  bill/transfer notice was posted earlier. `listMatches`, daily review queues, closing snapshots,
  and reports all use `matchTransactionDateSql()`. A multi-document group uses its earliest slip
  as one stable transaction date, so the same group never appears on two days.
- Utility payments can arrive later than the normal 48-hour window. A completed payment to
  `การประปาส่วนภูมิภาค` is `category='transfer'` with `bill_purpose='ค่าน้ำประปา'`. Match it to the
  water bill using the authority identity, exact amount, and customer/water-account references when
  available; allow up to 14 days between the bill and payment instead of pairing it with a nearer
  unrelated slip.
- Makro bills and their payment slips use different names: `Makro`, `สยามแม็คโคร`, and
  `บริษัท ซีพี แอ็กซ์ตร้า` on the bill correspond to `CP AXTRA PCL. SMARTONE` / Biller ID
  `010756700041404` on the slip. For these payments, the slip's `เลขที่อ้างอิง` must equal the
  bill's `doc_ref` / Tax Invoice No. / Ref 2. An explicit mismatch rejects the candidate even when
  amount and time are identical; an exact reference match has priority over proximity.
  Historical rows can be repaired without another vision call by running
  `npm run cp-axtra:backfill` (dry run) and then `npm run cp-axtra:backfill -- --apply`.
  It extracts the already-OCRed Ref 2 into `doc_ref`, resets only unreviewed AI-pending CP AXTRA
  pairs, and proposes replacements for human review. It never changes a confirmed/manual pair and
  never processes another supplier.
- **The day view keeps a wider lookup pool.** `data()` fetches items for the scoped day **±2 days**
  into `S.pool` and derives the day-scoped `S.items` from it. `item()` and the slip picker read
  `S.pool`; buckets/counters read `S.items`. Without this the counterpart of a cross-day pair is
  `undefined` — the review panel renders no slip image or amount, and the slip picker offers
  nothing. If you change the pool width, keep it ≥ `AI_MATCH_MAX_HOURS`.
- **A late slip reopens affected closed days.** `setItemMatch` calls `reopenClosedDayForItem` for
  both bill and slip. The slip day owns the resulting transaction, while reopening the old bill
  day allows a stale pre-rule snapshot to be closed again without that transaction. The board
  shows a red "เปิดใหม่อัตโนมัติ" chip and the day view a banner, so the day is
  never silently reopened. Closing is rejected with HTTP 409 while any bill/slip, amount flag,
  orphan page, pending reimbursement, download, or AI classification is unresolved. A successful
  close stores immutable transaction/member/attachment/reimbursement data in `summary_json`;
  printed reports never mix that snapshot with later live rows.

### Manual amount corrections
- Changing a document to **bill** or **transfer slip** is one atomic classification-and-amount
  decision. Every desktop/mobile entry point must ask for a positive amount before submitting; the
  category API rejects a resulting zero amount with `document_amount_required`. A successful change
  stores the amount, records the category correction, and immediately runs matching.
- Admins may correct amounts for both unmatched bills and unmatched transfer slips. Store bill
  corrections in `bill_total_edited_at/by` and slip corrections in `slip_amount_edited_at/by`.
- The desktop **บิลไม่เข้าคู่** panel must expose its bill amount input beside the candidate picker;
  saving it immediately runs auto-matching and opens the proposed pair when one is found.
- `applyAiAnalysis` and AI reset flows must preserve a manually corrected amount. Re-analysis may
  refresh OCR and classification, but must not silently overwrite a number a user confirmed.
- An amount correction must re-run compatibility checks and auto-matching because it changes the
  evidence used to form a pair.

### Multi-page bills (ใบกำกับหลายหน้า)
Wholesaler invoices (Makro et al.) are photographed one page at a time and **only the last page
carries the payable grand total**; earlier pages just list items and say "มีต่อหน้า N".

- `applyAiAnalysis` demotes a `bill` with `page_count > 1` and no positive total to
  **`category='bill_page'`** — a continuation page. This keeps it out of `needs_amount`
  (it has no amount to enter, so it would be an unresolvable phantom task) and out of matching.
  The existing `IN ('bill','transfer','transfer_notice')` whitelists already exclude it.
- The prompt forbids promoting a line item/subtotal to `bill_total_value` on a page with no
  final total — better a null total than a wrong match.
- **A `bill` with no positive amount must sit in `needs_amount`, never `unmatched`.** Without an
  amount the matcher has nothing to score, so such a bill can never leave the `bill` bucket —
  its only action there is "เลือกสลิป", which cannot succeed. `markBillsMissingAmount()` enforces
  this and now runs **on server startup** (next to `markSemanticDuplicateBills`) as well as inside
  `rebuildAiMatches()`. Startup is what repairs rows that arrive already wrong, e.g. a fresh
  production snapshot copied in by `npm run preview:sync`.
- The day view groups pages by `doc_ref`: the review panel shows the other pages of the same
  invoice as thumbnails, and an **`orphan_page`** bucket lists pages whose invoice has no payable
  page yet (i.e. someone forgot to photograph the last page). Orphans DO count as work.

## 7. Business date invariant (do not break)

An unpaired item's "day" = **Asia/Bangkok** calendar date of `event_timestamp_ms`
(fallback: first 10 chars of `created_at`). This MUST be computed identically in two places,
or the day board and the scoped queue disagree:

- **SQL:** `matchBusinessDateSql()` in `db.js` →
  `date((event_timestamp_ms/1000)+25200,'unixepoch')` else `substr(created_at,1,10)`.
  Used by `listDays` and `listItems`. Paired matches/transfer-paid closings use
  `matchTransactionDateSql()` and therefore anchor to the slip date.
- **Frontend:** `dateOf()` in `index.html` → `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'})`.

Never filter items/matches by raw UTC `created_at` for date scoping — it drifts near midnight Bangkok.

## 8. HTTP API

Public: `GET /health`, `POST /webhook` (+ aliases `/api/webhook`, `/api/line-bill-capture/webhook`),
`GET /` → redirect `/admin`. Authenticated pages are `GET /admin` (+ static assets) and the
mobile PWA shell/routes under `GET /m3/*`. Retired `/m` and `/m2` routes return 404. The admin page route
`GET /admin/day-report?date=YYYY-MM-DD&group=...` renders the printable A4 report only when that
day/group closing is currently `closed`; `autoprint=0` suppresses the automatic print dialog for review/testing.

Admin (`/api/admin/*`, JSON):
- `POST decision-contexts` and `GET decisions` implement the silent user-action audit log. There is no
  Agent Health page, Shadow prediction, AI comparison, reason dialog, or follow-up-question endpoint.
- `GET ai/status`, `POST ai/run`, `POST ai/rematch`, `POST ai/reset-all` (re-reads non-manually-classified downloaded images and resets AI-created pairs; optional JSON `start`/`end` scopes the reset by Bangkok business date, and `source_id` limits it to one LINE group. The admin UI only ever calls it with one day + one group, and hides the button outside the day view, because a wider reset undoes confirmed AI pairs across groups)
- `GET days`, `POST days/close`, `POST days/reopen`
- `GET items` (supports `flagged=1` and returns `flagged_count`), `PATCH items/:id` (including cover `supplier_name` correction), `PUT items/:id/category`, `GET items/:id/image`, `GET items/:id/context`, `POST items/deduplicate`, `POST items/:id/resolve-flag` (clear, manually set, or apply announced bill amount)
- `GET cash-payments/recipients` (recent confirmed cash recipients, for the payment-form history),
  `POST items/:id/cash-payment` (confirm full cash payment), `PATCH items/:id/cash-payment`
  (edit recipient/note), `POST items/:id/cash-payment/void` (required audit reason)
- `GET items/:id/receipt-substitute-draft` (prefill from an unmatched slip), `POST receipt-substitutes` (create an idempotent manual bill and confirm it against that slip)
- `GET messages`, `GET senders`, `POST senders/refresh`, `GET groups`, `GET matches`, `POST matches`, `POST matches/:id/learning-feedback` (store owner correction of AI reasoning/ranking without changing the confirmed transaction)

All non-GET browser mutations except category-learning clarification require `X-Decision-Id` and
`X-Decision-Reason-Code: user_action`; missing metadata returns 422. Logging happens silently without
asking for a reason or sending page context to another AI. LINE webhook ingestion and scheduled
workers never create fake user actions. The maintained action matrix is
`docs/DECISION_ACTION_REGISTRY.md`.

Desktop `จัดเป็นอื่น ๆ` is an explicit review loop: the operator describes the image, AI reads the
image together with that reason, and the modal shows either agreement or one clarification question.
When learning is enabled, the final category mutation is allowed only for an accepted review of the
exact latest reason; editing either answer invalidates the review. Disabling learning still permits a
manual category correction and records no learning example.

AI matching is proposal-only. Neither `ai-worker` nor any background path may write a confirmed
match; `setItemMatch` and `setItemMatchGroup` downgrade such attempts to `pending`. Startup also
moves legacy AI-only confirmations back to review and reopens affected closed days. The desktop
completed view always displays the stored AI reasons and human reviewer, and uses the dedicated
learning-feedback endpoint when the owner corrects reasoning/ranking so accounting state is untouched.

Message/context responses include `capture_item_id` when an image message has a stored
`capture_items` row. The admin chat timeline uses this ID with the item image route, so image
events render as the original captured image instead of `[image]` text.

**Production uses operator selection only** (`ADMIN_AUTH_MODE=operator_only`, user request
2026-10-05). `/admin` and `/m3` redirect new browsers to `/auth/operator`, preserving the requested
page/month. `/api/auth/operator` accepts an allow-listed name, then creates both the signed
HttpOnly session and operator cookie. `dot` is included. Anyone with the URL can select any name
and access/edit bills; this is an audit label, not verified identity or an access barrier.
APIs/images still require those cookies so actions retain the selected name. PIN login returns
410 and private-link tokens are ignored in this mode. `POST /api/auth/logout` clears both cookies.
Credential mode remains available when the mode is unset. `/health` remains public; LINE webhook
signature verification and the separate accounting-export token are unchanged.
In credential mode, configured operator cards follow credential login. In operator-only mode the
cards are the first screen. The signed operator cookie works across desktop/mobile routes and is
written to audit fields; the cards do not grant different permissions or verify identity.
Operator-only pages fail closed with 503 if no names are configured. Credential mode fails closed
when neither access method is configured. `npm run preview`
explicitly bypasses auth only while the server is bound to `127.0.0.1`; the bypass cannot be
enabled on Railway's non-loopback host.

## 9. Frontend notes (`public/index.html`)

- Single file, no framework. Global `S` = app state; helper fns share the top-level scope
  across the multiple `<script>` tags.
- Views: **board** (list of day×group cards), **day** (LINE chat + scoped work workspace), and
  **flags** (the "ต้องตรวจยอด" list), selected by `S.view`. The header `.tabs` switch between
  board and flags; **day is a drill-down of board**, so the board tab stays active there and
  `#daychrome` (backbar only) is its chrome. Bucket tabs live inside the sticky right workspace.
- Design intent is a quiet back-office instrument: **numbers are the hero, prose is minimal.**
  Don't reintroduce headings that repeat the active tab, instructional sentences, or run-on
  label+number lines — use chips, a progress bar, and colour instead. Font is IBM Plex Sans Thai
  (Thai+Latin) with tabular numerals; any replacement must cover Thai glyphs.
- Each LINE group gets a distinct colour from `GPAL` **by its index in `S.groups`** (`gcolor()`).
  Do not hash the group id for colour — real ids share long prefixes and produce near-identical hues.
- **`syncView()` is the single authority for view toggling** — it sets `hidden` on `board`,
  `worklayout`, `backbar` and `flagboard` from `S.view`. When adding a view, add its container
  to `syncView()` and switch views by setting `S.view` then calling `syncView()`. Never toggle
  those containers by hand: any path that calls `syncView()` later (reload, leaveFlags,
  openFlagInDay) will otherwise leave a stale panel on screen.
- **Day view = chat + work buckets.** The sticky left panel is the LINE timeline around the
  selected item/pair; it renders sender, timestamp, text, stored images, and highlights the target.
  The right panel contains `BUCKETS`, a horizontal queue, the document preview, and the active
  command. `needs_amount` exposes its amount input in the detail panel; `bill` exposes
  "เลือกสลิป" and "จ่ายเงินสด" there. Cash confirmation is always an explicit human action;
  amount/date are read-only and recipient/note are required. `renderChatPanel()` fetches up to 200 messages in a ±6 hour window through
  `GET items/:id/context`; keep its scrolling inside `#chatlist` so the day backbar stays visible.
  The "ค้าง N" tag = review + needs_amount + slip + bill, and **must reconcile with the board's
  `ค้าง`** — so `other` (AI junk) and duplicates are deliberately excluded from work counts.
  Keep both sides in sync if you change either counting rule (see `listDays` in `db.js`).
  Images with `ai_status` pending/processing/failed belong in **รอ AI อ่าน**, never **อื่น ๆ**.
  Chat days loaded with the inline previous/next controls are persisted in `S.contexts`; background
  queue refreshes must preserve that expanded date range and scroll position instead of rebuilding
  the timeline from only the selected document's business date.
  Re-reading is destructive because it clears prior OCR and AI-created pairs, so both the UI and
  `POST ai/reset-all` must refuse to start while the AI worker is disabled.
- CSS gotchas:
  - Author rules like `.layout{display:grid}` override the `[hidden]` attribute, so there is a
    `[hidden]{display:none!important}` reset — keep it.
  - `.empty` is a **global empty-state class with `min-height:320px`** — never reuse that word as
    a modifier on small elements (a zero-count chip modifier is `.zero` for this reason).
- `group()` labels come from `/api/admin/groups` (env `LINE_BILL_CAPTURE_GROUP_LABELS`), with a
  hardcoded `GROUP_NAMES` fallback for two known groups.

### Mobile V3 accessibility trial (`mobile-admin-v3/`)

- Keep V3 isolated under `/m3/*`; the older `/m` and `/m2` frontends have been removed. It uses the same authenticated
  `/api/admin/*` endpoints and a distinct PWA scope. Never cache API responses, evidence images,
  chat context, or other financial data.
- Optimize wording and interaction for older users: body copy is readable without zoom, controls
  are at least 52px where practical, labels describe the result of an action, and advanced options
  stay secondary to the one next task. Loading pages must show a loading state rather than a false
  zero-work summary.
- Daily work is explained in order (fix amount, verify proposed pair, find missing evidence).
  Pair review explicitly asks the user to inspect both images, compare bill/transfer amounts, and
  then confirm. Multi-document matching is a two-step bill-then-slip flow with persistent totals.
- Multi-document pickers on desktop and V3 expose AI-confidence, oldest-first, and newest-first
  ordering. Mobile searches the same LINE group across the loaded +/-14-day pool. Exclude bill
  pages, cash-paid documents, active matches, amount flags, and documents waiting for an amount.
  AI ordering only helps the reviewer find evidence; it never confirms a group.
- `setItemMatchGroup` canonicalizes bill and slip member IDs by the original LINE timestamp before
  saving. Confirmed-day snapshots and reports preserve that chronological order, regardless of the
  order in which the reviewer tapped the documents.
- Error, empty, search, amount-flag, and system-status pages must tell the user what to do
  next in Thai; avoid exposing internal action keys as the primary label.
- Validate at 320x700, 390x844, 430x932, and 768x1024. Run `npm run mobile3:random-test` against the
  loopback preview and inspect screenshots in `artifacts/mobile-v3/`.

## 10. Testing

- `npm run smoke` boots a throwaway server with `AI_PROVIDER=mock` and drives the full pipeline
  (webhook → download → dedup → AI → match → reassign → unsend). Extend it when adding behavior.
- The mock analyzer keys off the message id / filename (`slip`, `bill`, `bill-alt`, `bill-noamount`)
  and, for bills, parses amount/purpose from the injected nearby text.
- Always run `npm run check` (syntax) + `npm run smoke` before deploy.
- `npm run check` also runs all three mobile Vitest suites and production Vite builds. Docker builds
  the three mobile bundles in separate stages and copies only each `dist` into the runtime image.
### Capturing why the AI was wrong (`ai_learning_examples`)

The table and the prompt injection existed from the start, yet it initially held **0 rows** — the old UI
required the reviewer to type a note *and* tick a checkbox, so nobody ever did it. `ai-trace`
confirmed it: `context.learning_examples` was `0` on every single call.

That is historical, not the current state. The 24 August production snapshot contains 30 approved
examples (11 pair decisions and 19 category corrections). The worker currently injects only the 12
most recently prioritised rows into each image prompt; it does not yet retrieve examples by semantic
relevance, participant, branch, supplier, or document type. See `docs/AI_LEARNING_STATUS.md`.

Pair review now collects a compact reason on both the positive and correction paths:

- Confirming a pair offers one-tap positive reasons such as matching amount, recipient, reference,
  chat context, or manual image review.
- Rejecting a proposed pair (**ไม่ใช่คู่นี้**) and unconfirming a pair (**ยกเลิกการยืนยัน**) use
  one-tap negative reasons such as amount mismatch, different vendor, a slip for another bill,
  unpaid bill, incoming transfer, or different branch.
- A preset button submits immediately and sets `ai_learning_approved`; there is no second confirm
  button or learning checkbox. Custom reasons still require explicit text confirmation.
- A typed case-specific note is itself the approved reason and suppresses the preset sheet.
- Optional LINE evidence must be selected before tapping the reason. Never infer human evidence from
  unselected nearby chat.
- **Skipping remains allowed** on the dedicated correction sheet and still performs the correction.

`renderLearningExamples` turns each row into one line of the prompt
(`CORRECT PAIR/WRONG PAIR: <note> | bill=… | slip=…`), so the note must read as an instruction to a
reader who cannot see the images. Preset wording is chosen with that in mind.

### Tracing what the AI actually did (`ai-trace`)

`src/ai-trace.js` appends one JSONL line per vision call to
`<CAPTURE_DATA_DIR>/ai-trace/<Bangkok date>.jsonl` — the only way to answer "why did the AI decide
that" after the fact. Disable with `AI_TRACE_ENABLED=0`.

```bash
node scripts/ai-trace.mjs                  # today's summary
node scripts/ai-trace.mjs --item 226       # full record for one image
node scripts/ai-trace.mjs --failures
node scripts/ai-trace.mjs --slow 8000
```

- Two events: `analysis` (tokens, duration, context sizes fed to the prompt, and the decision) and
  `failure` (attempt number, `error_kind`, whether a retry is scheduled, message).
- **Writing a trace must never break an analysis.** `traceAiRun` swallows its own errors and uses a
  synchronous append; keep it that way. A full disk should cost you observability, not OCR.
- Long text is clipped before it is written, so raw OCR of a whole page never lands in the log.
- It records `context.learning_examples`, which verifies how many owner-taught examples were actually
  injected into that specific call and catches an empty or stale retrieval path.

### Measuring AI quality (`npm run eval`)

The system's own history is the labelled dataset — every human decision is ground truth:

```bash
npm run eval:build   # golden set from human decisions -> .local-preview/eval/golden.json (gitignored)
npm run eval         # score it. Costs nothing: replays stored ai_result_json + the real scoreSequencePair
npm run eval -- --verbose --min 90
```

- **`build-eval-set.mjs` counts only human-reviewed matches.** A legacy `confirmed` row alone was
  not ground truth because older builds allowed AI auto-confirmation. Startup now moves those legacy
  AI-only confirmations back to `pending`. Negative examples exclude system resets (`created_by='ai-worker'` with a "รีเซ็ต"/"จัดคู่ใหม่"
  reason); only an admin's own rejection counts.
- It also snapshots every slip in the same LINE group within ±72h so the matcher has wrong answers
  available. Score the true slip against a pool of one and you measure nothing.
- **Never measure amount accuracy on the set of amounts a human edited.** A human edits an amount
  precisely *because* the AI got it wrong, so that set scores near 0% by construction. Measure
  instead over every bill in a confirmed pair: did the AI read it without needing a human?
  Keep "how many a human had to fix" as a workload number, not an accuracy number.
- `--min N` exits 1 below the threshold, so it can gate CI. It exits 0 with a notice when no golden
  set exists yet, so a fresh clone does not fail.
- Baseline recorded 2026-08-17 (59 human-reviewed pairs): matching 94.9%, category 100%,
  amount-read-unaided 93.2%, overall 96%.

- `npm run mobile3:random-test` runs the retained mobile UI audit against a loopback preview.
  Desktop routes are covered by `npm run button:audit`.

## 11. Known state / TODO

- **Production uses operator selection only, not verified identity.** Audit fields retain the
  selected name, including `dot`, but anyone with the link can select that name. Credential-mode
  deployments retain PIN rate limiting. Tests must establish the session/operator cookies before
  using admin routes; anonymous API calls do not bypass the selector.
- **Matching floor:** code default is 50 and the last audited production value was 55. Never lower
  this near 1; it floods the review queue with unrelated pairs.
- **Built:** the "ต้องตรวจยอด" (flag) page lists all unresolved `amount_review_flag=1` items,
  including unmatched bills, with document-vs-announced amounts, nearby chat context, and a
  detail drawer. `POST /api/admin/items/:id/resolve-flag` records the resolving admin and time;
  it can clear the flag, save a corrected bill amount, or apply `announced_amount` in one step.
  The drawer makes this decision explicit: **ยอดในเอกสารถูก**, **ยอดที่แจ้งในแชทถูก**, or a
  manually entered correct amount.
- The top-bar global search queries item id, supplier/purpose, amount, document reference, notes,
  and LINE sender name. Results support arrow-key navigation and open the exact date/group work
  view. Less-frequent AI actions live under the **เครื่องมือ AI** menu.
- LINE Notify / Sheets export are not part of this service.
- The read-only machine contract `/accounting-export/rounds` and `/accounting-export/rounds/:roundId/snapshot` is reserved for the standalone management-accounting service. It is protected by `LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN`; open rounds return status only and the snapshot route returns HTTP 409 without bill content until the day is closed. Each bank-transfer item includes `payer_account_name`, `payer_bank`, `payer_account_masked`, and `payer_accounts`; the same masked fields are present on each `raw_transaction.slip_members` entry.
- LINE remains silent by default. The only optional reply path is an explicit `ตรวจบิล` request in a group configured in `LINE_BILL_CAPTURE_VALIDATION_GROUPS`; the reply is sent to that same group. Production capture-only deployments set `LINE_BILL_CAPTURE_SILENT_MODE=1`, which hard-blocks that path and every explicit admin push without stopping webhook capture.

## 12. Glossary (Thai)

- **บิล (bill)** = vendor/market order bill image. **สลิป (slip)** = bank transfer proof.
- **แจ้งโอน / แจ้งให้โอน** = announcing a payment in chat. **ค่าอะไร** = what the charge is for → `bill_purpose`.
- **ปิดรอบ (close day)** = finalize a day's matches for a group; **เปิดรอบใหม่** = reopen.
- **ยอดไม่ตรง / ต้องตรวจ** = amount mismatch → `amount_review_flag`.
- **กลุ่ม / สาขา** = a LINE group ≈ a branch (`source_id`).

---

## Rules for keeping this doc updated (กติกาต้องอัปเดต)

Update **this file in the same change** whenever you:

1. Add/rename/remove a **table or a meaningful column** → update §5 (and §7 if it affects dates).
2. Add/change an **HTTP route** → update §8.
3. Add/change an **environment variable** → update §4.
4. Change a **core flow, matching rule, or an enum value** (category/status/match_status/ai_status) → update §5/§6.
5. Change the **deploy process** → update §2.
6. Finish something in **§11 "Planned/TODO"** → move it out of TODO and document it as built.

Keep it accurate over exhaustive: document what an AI must know to work safely (invariants,
gotchas, guardrails), not every line of code. If a statement here ever conflicts with the code,
**the code is the source of truth — fix this doc.**

## AI claim lifecycle and durable evidence (2026-10-03)

- Each worker claim increments `capture_items.ai_generation` and stores a unique `ai_claim_token` plus `ai_claimed_at`. Only the current processing claim on a downloaded item may apply success/failure. Reset/requeue/unsend invalidate claims; never apply an unclaimed result.
- `ai_analysis_claims` retains immutable claim identity; `ai_usage_records` retains actual returned usage once per claim, including stale results that incurred usage. Reset does not erase this ledger. Pricing estimates are stored per analysis using that job's rates. `ai_usage_metadata.recorded_since` defines complete tracking start. Migration imports only the latest known per-item usage as `legacy_latest`; earlier usage and unavailable prices are unknown, not zero. UI must disclose this coverage.
- Queue recovery settles stale processing at the configured maximum attempts as failed `attempts_exhausted` with no automatic retry. Earlier stale attempts may receive a new claim. An explicit reread resets the attempt budget. `storage_missing` remains a distinct actionable failure; this does not recover an absent source image.
- `line_unsend_tombstones` durably records cancellation even before an original message exists. Late originals/replays stay unsent, excluded from downloads/AI/context/validation. Startup imports historical unsend events and settles resurrected rows through normal unsend accounting cleanup. Raw events remain available as evidence.
- Run `scripts/ai-lifecycle-regression-test.mjs` with Node 24; fixtures use isolated temporary SQLite only. No Production repair or deployment is implied.


## UX phase 1 decision corrections 2026-10-05

Desktop rejection reasons are selection-only until explicit submit. Close, Escape and backdrop dismissals return a cancellation sentinel and never mutate the pair; the separately labelled submit-without-reason still performs the chosen correction. Notes are local review notes by default; pair learning requires an unchecked opt-in. Group notes are accepted as `review_note` by POST /api/admin/match-groups and stored on every group edge without implicit learning approval. AI prompt retrieval only includes match examples still approved by their current match with the same note, so Undo disabling approval removes a stale example from future prompts while retaining the historical row. Group amount proposals only use currently visible candidates and preserve search filters. These changes do not introduce new enum values, tables or routes.


Desktop confirmation now shows completed evidence before a separate next navigation action. Result-state guards prevent queue enhancers from attaching another match's note/form to that completed result; chat focuses its completed documents. Pair/group Undo keeps the reviewed selection and is available for 30 seconds. Match-learning prompt retrieval also checks current status against example outcome: positive requires confirmed, negative allows rejected or pending (explicit Unconfirm). Replaced positives stay in history but are excluded. Scores use similarity points /100; human-created groups show source attribution without AI confidence. Cash and LINE request labels state the actual effect. No new routes, enum values, tables, migrations, or automatic Production corrections.

## Desktop workflow guidance 2026-10-05

`public/workflow-guidance.js` and `.css` progressively disclose existing correction controls on desktop bill/slip/pair reviews. Problem selection only opens guidance and preserves the original handler/audit/lock. Receipt substitution from the unmatched slip view requires explicit expense and evidence-search acknowledgements (UI only, not a new API guard). Non-purchase/incomplete paths explain limitations; they do not create a transaction category or persisted parked state. Reimbursement and completed-result flows retain their own controls. No schema, enum or financial rules change.

## Scope and receipt retry safety — 2026-10-06

- LBC-01: Desktop data loads capture route scope and generation; stale success/errors and hydration cannot commit after navigation. Background polls skip pending navigation. Financial actions wait for a successfully loaded scope.
- LBC-02: Receipt substitute retries are read-only only when payload, document category and confirmed pair remain identical. Changed payload, rejected pairs and recategorized documents return HTTP 409 with existingItemId; the UI retains typed fields and links the original document. No new version or financial correction is created automatically; original documents and audit remain intact.
- Regression: `node scripts/scope-receipt-regression-test.mjs` through the SSD runner.


## Other classification options 2026-10-06

`public/not-document-options.js` adds reason presets and a custom explanation to the desktop Other dialog. Presets are per-item reasons, not new category enums. AI analysis and AI learning are separate opt-ins, both off on each open. Manual mode uses the existing category route with `record_learning:false`; analysis never saves a category by itself. Learning still requires an accepted review for the current explanation. Superseded analysis results cannot overwrite another item or edited explanation. No schema changes.


## Expense document profile MVP 2026-10-06

Per-document expense facts are stored separately from capture amounts/matches in capture_expense_profiles and immutable capture_expense_profile_revisions. GET/PUT /api/admin/items/:id/expense-profile separates stored OCR suggestions from human saved fields, uses optimistic revisions and decision actor/action/entity binding, and does not call AI or export accounting entries. public/expense-profile.js/.css preserves in-page drafts per item; database draft saves survive reload. reviewed means document facts reviewed, not accounting/payment approval. See docs/EXPENSE_PROFILE_MVP.md for roles, evidence limits and tests.

## Expense facts desktop completion — 2026-10-06

Design scope is desktop only (1280×800,1440×900,1920×1080) per user goal. See docs/EXPENSE_DESKTOP_DESIGN.md. Native dialog keeps evidence/printed amount left and facts right with stable header/footer; reviewed-save validates/focuses missing fields and history exposes old/new sourced values. Manual drafts and stale-scope guards remain.

Maintained fictional fixture: scripts/expense-desktop-preview.mjs via SSD runner Node24; it creates new SSD-only SVG files/SQLite and confirms six authenticated image endpoints before emitting its report. scripts/expense-desktop-flow-test.mjs drives real browser controls with Playwright CLI/fresh snapshot refs against this loopback fixture; its fixture flag must point to an SSD report. Network failure simulations only intercept that fictional browser, never Production. All browser artifacts remain in runner reports/output/playwright. Prior mobile tests remain regression coverage; no mobile redesign or mobile deliverable is claimed here.


## Production expense release — 2026-10-06

Expense facts desktop UI and Other classification options are live on Railway deployment bbfd4352-5930-4133-8409-8edc4b9fd866 (SUCCESS). Controlled release patches current e068 runtime; unrelated canonical AI lifecycle/usage/tombstone and closing/auth changes remain outside this release. Check/smoke, 110 backend checks, HTTP/UI regressions, independent review and real-data migration rehearsal passed on SSD. Fresh consistent DB+images backup restored and verified; Production runtime hashes/health/authenticated reads/UI pass. Matching, amounts, cash, closings, learning and chat records preserved; only known missing image645 updated_at changed by inherited startup repair. New profiles/history empty until users save. Writes/persistence verified on SSD, no invented Production facts. Desktop facts UI is integrated via a modal from existing admin, not a new inline combined page; existing Mobile V3 compiled bytes preserved.

Release log/evidence: /Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-facts-20261006-1791281997/release-report.md


## Expense form and Other presets phase 1 — 2026-10-06

- Other dialog adds preset `cashswap` "แลกเงินสด / โอนภายใน (ไม่ใช่ค่าใช้จ่าย)": a per-item reason only, not a category enum; presets are now 6 + custom. Slip amount is not stored as a separate fact; a dedicated transaction type holding the amount was proposed, not built.
- `saveExpenseProfile`: `reason` is optional for `status:'draft'`; empty/blank stores `บันทึกร่าง` (`EXPENSE_DRAFT_DEFAULT_REASON`). `reviewed` still returns `reason_required`. Over 500 chars or non-string is still rejected for both. Audit decision, immutable revisions and `revision_conflict` 409 are unchanged.
- Form (`public/expense-profile.js`): `expenseProfileRequirements` mirrors the server review rules to show "จำเป็นสำหรับตรวจแล้ว" markers (type always; purchase → purpose+supplier; non-purchase lacking supplier/purpose or unknown → notes; supplier≠recipient → relation). `internal_transfer` and `loan` collapse the shop/relation section (stored values stay and auto-open). Saving `internal_transfer` does NOT change category/match_status, so the slip stays outstanding; use Other→cashswap to close it. Mobile V3 and accounting export untouched.

## Expense assist phase 2 — 2026-10-06 (branch lbc/phase2-expense-assist, ยังไม่ deploy)

Expense profile gains two additive `source` values, `paired_document` (confirmed bill↔slip partner's profile) and `remembered_pair` (shop↔payee↔relation from other items' reviewed profiles), a read-only `GET /api/admin/expense-profile-options` (shop/payee/bank names only, for datalist) and an "ใช้ข้อเสนอทั้งหมด" button that fills only blank, visible fields into the draft. No schema/table change. Suggestions never auto-save; account values stay masked (≤4 digits) and history never suggests accounts. Assisted evidence references other items and is validated against immutable revisions. See docs/EXPENSE_PROFILE_ASSIST.md; code in src/expense-profile-assist.js and public/expense-profile-assist.js.

## Expense status in queue and accounting summary — 2026-10-06 (phase 3)

Desktop-only (accounting). Read-only status of each image's expense facts: `none` (no row in capture_expense_profiles) / `draft` / `reviewed`. Logic is isolated in `src/expense-status.js` and `public/expense-status.js/.css`. `GET /api/admin/expense-status/items?ids=` (batch, max 1000, auth, never creates rows) and `GET /api/admin/expense-status/summary?start&end&source_id` (range ≤ 400 days). Counted: `bill`, `payment_voucher`, `transfer`, `transfer_notice` that are not `unsent`/`duplicate`; NOT counted: `other` (incl. batch_payment_summary), `bill_page`, `incoming_transfer`, `pending`. UI: badges in the queue and detail header, status filter above the list (hooked only in `renderList` via `window.expenseStatusFilterRows`, so `bucketRows`, `dayWorkCount`, `outstandingItem` and day close are unchanged), and a "สรุปข้อมูลค่าใช้จ่าย" dialog from the rail with click-through via `jumpToProcess`. `reviewed` shown as "ตรวจแล้ว" in a neutral colour with the note that it is a document-facts check, not payment/accounting approval, and it never blocks closing a day. Test: `scripts/expense-status-test.mjs` (in `npm run check`).

## Production expense phases 1–3 release — 2026-10-06

Live on Railway deployment 05c55f56-7195-4395-a9de-657c7db7eba4 (SUCCESS), built from branch `lbc/integration-20261006` (base `lbc/production-base` = previous deployment bbfd4352). Runtime hashes verified before/after; data counts and item/match fact hashes unchanged. Mobile V3 dist preserved. Evidence: /Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-phases123-20261006-1791298673/release-report.md



### Expense facts enums and provenance — Local phase 4/5, 2026-10-06

`EXPENSE_TRANSACTION_TYPES` additionally accepts `government_remittance` (นำส่งหน่วยงานรัฐ / เงินหักพนักงาน). Reviewed requires purpose + recipient_name + branch; supplier, supplier/payee relation and exception notes are not mandatory for this type. Other transaction rules remain unchanged. These are document facts, not posting/payment approval.

New evidence sources: `ai_summary` (purpose/type, own item evidence), `group_label` (branch only, own group item evidence), `paired_ocr` (recipient name/bank/masked account only, an active same-group/same-business-date linked slip). Chat suggestions use active text with exactly matching stored document amount within ±30 minutes on the same group and business date; conflicting meanings are not guessed. Source type/field/reference checks apply on save. Own existing proposals win; additions fill gaps before phase-2 assist fills remaining fields. Every proposal still requires explicit user adoption/save. New module: `src/expense-profile-suggestions.js`; no AI request, automatic backfill or matching change.

Expense GET/PUT responses and expense option values mask account-like long digit strings including saved free text/history; no raw OCR/AI JSON is added to this contract. Masked account input still permits at most four digits. Immutable revisions, revision-conflict HTTP 409 and decision audit remain unchanged.

## Expense desktop pair review — Local phase 5, 2026-10-06

`public/expense-pair-review.js` presents reopened-day state as one next-action message; `dayWorkCount`, `outstandingItem`, server closing criteria and existing confirm/unconfirm/Undo handlers are unchanged. Pair expense entry is one button directly under amount boxes, with a 2-document switch inside the dialog and separate drafts by ID. Existing >2-document chooser stays (tested #2557, all 25 documents). AI reasons show up to five useful statements; remaining statements are disclosed by “ดูทั้งหมด”. Negative historical justifications of confirmed pairs are labelled as pre-confirmation references. Raw LINE sender IDs appear only inside explicit sender details. Queue names fall back to existing purpose/supplier/AI summary, with historical missing-payment wording removed on confirmed fallback titles.

No new route, table or environment variable for the service; the existing expense endpoints serve additional proposals. Mobile V3 source/compiled assets are outside the change; required build runs only on SSD simulation. Local test helpers accept EXPENSE_PHASE45_SNAPSHOT / EXPENSE_PHASE45_BASELINE / EXPENSE_PHASE45_BACKUP paths for existing SSD evidence copies (tool-only variables, not runtime configuration). Run `npm run expense:phase45:check` and `npm run expense:phase45:browser` only through the SSD runner with bundled Node24; real-case tests require the documented SSD backup. All changes stay in isolated worktree 455c until explicitly integrated/released.

Report: `/Volumes/SSD Files/SOLAO/line-bill-capture/reports/expense-phase45-20261006-455c/report.md`.

## Expense phase 4–5 release integration — 2026-10-06

Phase 4–5 is integrated in codex/lbc-phase45-release from 0486c3d (latest Production phases 1–3, 05c55f56). Shared server edit is limited to importing safeExpenseResponse and masking expense-profile-options response; no lifecycle/closing/auth changes. Previously documented Local results remain historical. Release staging is /Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-phases45-20261006-455c/source; preserve compiled Mobile V3 bytes. Production result is recorded after verification.

## Production expense phases 4–5 — 2026-10-06

Deployed ab90ba47-d84d-4f4b-b12c-08b79f8a7fc6 (SUCCESS) from 5b1fe49, based on current phase 1–3 Production 05c55f56. The previously Local phase 4–5 behavior above is now live. Runtime hashes, health/authenticated reads and real desktop UI pass; protected data preserved except existing missing-image645.updated_at startup repair. Mobile compiled assets unchanged. No automatic expense saves; persistence/audit/conflict/Undo verified on SSD rather than invented Production writes. Report: /Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-phases45-20261006-455c/release-report.md. lbc/production-base is not advanced without separate approval; codex/lbc-phase45-release retains the released source.

## Expense form simplification — Local, 2026-10-07

The desktop facts dialog now has one primary form: transaction type, purpose, relevant supplier/relation, recipient and branch. Optional bank/account/department/notes and irrelevant supplier fields remain in an explicit disclosure, which opens for required fields/errors. With no selected type, supplier fields begin in the optional disclosure; adopting/selecting a type updates layout before apply-all evaluates visible fields. Values and sources are never discarded by collapsing.

Saved/dirty/loading status is shown once in the footer; revision zero is labelled not saved. Matching suggestions are hidden after adoption and become available again if the user edits/clears the value. Evidence is one compact source disclosure; paired and remembered references are handled by the main form instead of a second DOM rewrite in assist. Apply-all still fills only empty visible fields and never saves. The reload control and longer accounting-scope explanation are under record details. Reviewed still requires the unchanged audit reason, validation and optimistic revision contract. No backend/schema/routes/env changes.

Current browser verification: `node scripts/expense-form-ux-browser-test.mjs` through the SSD runner. Includes actual SSD snapshot cases #2335/#2345, partial/adopt-all UI, 1280/1440/1920 layout, evidence, optional fields, document switch, dynamic validation, save and 409/reload. Older desktop/assist CLI flows contain labels from the earlier layout; use the current UX browser suite for this layout. Report: `/Volumes/SSD Files/SOLAO/line-bill-capture/reports/expense-form-ux-20261007/report.md`. This is Local; no deployment in this redesign task.


## Expense preparation additive fields — Local, 2026-10-07

The existing per-document profile gains `expense_category`, `expense_period`, `followup_owner` and `classification_note` as human-reviewed facts in the existing profile JSON and immutable revision JSON. No new DB table/column, route or runtime environment variable is introduced. Existing GET/PUT, optimistic revision conflicts, source validation, decision audit and masked-account rules continue to apply. Saving still requires an explicit action; proposals never save automatically. The four new fields accept manual provenance only; no category/month/owner/classification-note proposals are introduced. Safe expense response masking preserves a valid Gregorian `YYYY-MM` period rather than treating its digits as an account number.

`expense_category` accepts `ingredients`, `packaging`, `personnel`, `utilities`, `premises`, `marketing`, `fees`, `asset_review`, `non_expense`, `other` and `pending`. These are expense preparation categories, separate from document category, transaction type and counterparty. `asset_review` records a need for asset treatment review; it does not capitalize a cost. `non_expense` does not reclassify a captured document or settle its outstanding match. `expense_period` is explicit Gregorian `YYYY-MM`, years 2000–2099 and months 01–12; never infer a posting period from the document/chat date.

The main form reads purpose → transaction type → expense category → expense month → beneficiary branch → recipient, retaining relevant supplier/relation fields and optional details. Choosing `pending` reveals the missing-information note (`classification_note`) and responsible person (`followup_owner`), permits an incomplete draft and blocks a new reviewed save. Existing type-specific review rules also remain in effect. Legacy reviewed profiles retain their stored status and history without backfill; new preparation completeness is a separate indication of missing classification facts, never accounting/payment readiness. Users must supply missing facts before a new reviewed save.

This increment only extends document facts. It does not add a payment ledger, expense amounts, accounting posting, matching/closing changes or export mutations. Local only: no Production data writes, deploy, push or commit in this task. Current scoped Node24 verification passes backend 171 checks, integration 12 groups, assist 75, assist UI 13 and draft/month UI validation. CUA verified pending rejection, draft/reload persistence, classified reviewed save/history and 390×844 dialog overflow after header/workspace fixes. Full check/build/smoke was not run for this increment; release verification remains required. Report: `/Volumes/SSD Files/SOLAO/line-bill-capture/runs/2026-10-07T07-04-48-905Z-5321ef7b/reports/preparation-report.md`.


## Transaction nature and expense category — Local, 2026-10-07

Desktop labels distinguish transaction nature (`ลักษณะรายการ`, transaction_type) from expense purpose category (`ใช้จ่ายเรื่องอะไร`, expense_category). Internal transfer, loan principal/repayment and remittance of withheld funds/existing obligations do not show an expense category selector. The government_remittance display label is now “นำส่งเงินที่หักไว้ / ชำระภาระเดิม”; the persisted enum is unchanged. This is not a general rule excluding every payment to a government agency from expenses.

Changing nature never silently clears a stored category: show its label and an explicit clear-in-draft button. Drafts may retain conflicts; reviewed saves reject stale categories at both UI and API (`expense_category_not_applicable`). `non_expense` remains accepted for old/draft records and immutable history, is absent from fresh choices, and blocks a new reviewed save (`expense_category_legacy_review`) until explicitly recategorized/cleared. Relation between legacy supplier and recipient is not required for these three natures, consistent with collapsed supplier fields. Purchase relation validation remains unchanged. No schema, routes, financial records, amount, close or payment approval changes.

SSD Node24 backend185 checks, UI validation and independent HTTP12 groups pass. Real rendered fictional browser test covers purchase → internal transfer, stale-category review rejection, explicit clear → reviewed save, switch back with empty category, draft/reload persistence. Local preview at50532; report under SSD run2026-10-07T07-33-19-236Z-06c716f1. No deployment.


## Expense user-error guards — Local, 2026-10-07

Computed `preparation` is separate from document review: `{status: ready|not_ready|not_applicable, fields_complete, missing_fields, reasons}`. Ready requires reviewed facts plus known nature, purpose, category, valid Gregorian month and beneficiary branch. A complete draft remains not_ready. Legacy/non_expense, pending, mixed and asset_review are not ready; `mixed` is a new manual category for multi-category bills awaiting actual allocation and blocks reviewed like pending. No amount allocation/ledger is added. Excluded natures always require notes for reviewed, including when old supplier/purpose are present. followup_owner remains backend/history-only per user request.

Existing status summary adds `transactions`, `transaction_counts`, `transactions_truncated` without changing document totals. Confirmed edges/group keys are unioned into full evidence components before date/source filtering (union-find); slips in a confirmed bill transaction are evidence, not a second expense. Readiness uses bills (standalone slip uses itself), and conflicting populated category/type/month/branch among any members makes the transaction not_ready. No sums or profit are calculated. Date scope is evidence/transfer anchor, not expense_period; UI states this. Canonical item is an entry point, not a new ledger row or automatic field merge. Unknown duplicates/unconfirmed matches remain separate until humans resolve them.

Historical 2026-10-07 rule (superseded by the user on 2026-10-09): expense profile editing previously required reopening a closed own/active-match anchor round. Current expense facts can be edited and saved while the round remains closed; see the 2026-10-09 entry below. Changing capture matching can legitimately change grouped summary; this summary is not a frozen financial closing.

Dirty close is labelled “ปิด · ยังไม่บันทึก”; beforeunload warns for any dirty in-memory record; no autosave or durable local cache is introduced. A valid month differing from document/evidence month triggers a nonblocking notice; missing/ambiguous dates are not invented. Proposals remain explicitly adopted facts only.

Verification: SSD Node24 full npm check (including Mobile test/build) and smoke pass, backend226 checks, HTTP13 groups, summary8 groups, UI/API readiness parity and raced-lock draft tests. Dedicated expense-round-lock-test covers own/aggregate anchors and explicit reopen. Real CUA fictional desktop checks mixed rejection, complete draft notready, reviewed ready, bill/slip count once, raced closing409 preserving draft, GET reopen and month notice. In-app browser beforeunload reload did not navigate; native prompt text was not exposed by this tool, so manual Chrome prompt-text verification remains a limitation. All artifacts on SSD run2026-10-07T07-45-30-119Z-cfe53024 and full-check run2026-10-07T07-45-16-077Z-8ed94967. Local only; no Production writes/deploy.


## Real-week trial and confirmed branch alias — Local, 2026-10-07

User authorized a fresh one-week real-data import on an isolated SSD copy. Maintained scripts expense-real-week-test.mjs and expense-real-week-preview.mjs require the verified SSD runner and a verified import manifest. Runtime is loopback, AIoff/mockLINE, private operator auth, no source snapshot writes. First tests preserve original SHA and protect financial tables; trial profiles and deliberately confirmed rehearsal edge exist only in copies. Import tooling/DB/images/reports are SSD-only under reports/real-week-20261007; no Production profiles/matching/closing are written.

237captures from2026-09-30..2026-10-06;162eligible documents,75excluded. No confirmed transaction groups in that actual week; label the view a preparation queue and explicitly state unconfirmed pairs remain separate. Native confirmed-group behavior was only simulated on a real-data copy. User explicitly confirmed สันกำแพง means บ้านเจ๊; expenseBranchFromGroupLabel changes only new branch proposals, never stored facts/history or source group labels. Outside-choice proposal count goes91→0. Keep exact matching; do not infer other aliases.

Latest backend226checks +alias cases, assist75, summary8 and162document draft/reload trials pass. Report /Volumes/SSD Files/SOLAO/line-bill-capture/reports/real-week-20261007/report.md. Identical slip images and Other financial-text candidates are investigation findings, not confirmed duplicate payments or missing expenses. Current scope contains no closed rounds; do not claim actual-data closed-round coverage.

## Evidence classification proposals — Local, 2026-10-07

expense-classification-suggestions.js proposes transaction_type/expense_category from selected purpose and explicit existing expense summary; raw OCR merchant headers are excluded. Never infer from payee/bank/amount alone; uncertain/negated/conflicting text abstains, multiple categories propose mixed. Read responses include separate suggestion_reasons; adoption entries stay {value,source,evidence}. New source classification is allowed only for those two fields; backend recomputes exact proposal and evidence before accepting a new adoption, while unchanged historical adoption survives later OCR correction. Expense period/owner/classification note remain manual-only. No autosave or new AI calls. Explicit apply-all still skips filled/hidden fields and processes nature first.

## Production expense preparation and classification — 2026-10-07

Authorized Production release now serves the formerly Local desktop/category/period/readiness/closed-round/classification changes above on SUCCESS556fefed-7042-4b07-a31f-6350013fdd0c. Released source21ec6cf, integrationbranchcodex/lbc-expense-integration-20261007. Baselinecurrentab90ba47 matched live hashes; uploadcontrolledSSDreleases/source (notruns) preserving Mobile compiledbytes. Fullcheck/build/smoke +closed-round tests and runtime/API/browser pass; DB+images restore/hash verified. Report /Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-preparation-20261007/release-report.md. Fourexistingexpenseprofiles/revisions unchanged. Concurrent legitimate match reviews/receiptcreation recorded separately; never assert whole Production unchanged while users operate. production-base remains historical pending its separately required authorization; use this verified released integrationbranch for expense follow-up. No automatic suggestions adoption, payment approval, accounting export or new AI call.

## Receipt substitute cancellation — 2026-10-07

POST/items/:id/receipt-substitute/void (admin authenticated +decision audit receipt_substitute.void) requires reason<=1000 and expected_updated_at. voidReceiptSubstitute serializes a tombstone statusunsent and generated_document_json voided/voided_at/voided_by/void_reason/voided_match_ids without new schema, preserving references/images/expense history. Reject closed own+source+active anchorrounds, broader components/cash/reimbursement relationships, wrongsource/nonreceipt andstale timestamp. Retry idempotent without replacing firstreason. Reject exactmatches+disablelearningapproval, syncsourceback to queue, no amount edits orfinancial writes; no automaticround reopening. Generated receipt files exempt from legacyunsentcleanup. Cancelledreceiptcannot be regenerated/edited/reclassified via metadata routes (409), must review actualsource slip/bill. Desktopstandalone receipt-substitute-void.js adds smallselected-document button, explicitreason dialog, guardsduplicates/scope, errorretainsreason. Matching source/broadergroup cancellation is deliberately rejected. Tests receipt-substitute-void-test/ui/http integratedcheck; actualcase250000 testedonSSDcopyonly.


## Production receipt cancellation — 2026-10-07

Authorized release SUCCESS `a3fd27b3-4876-40f3-9b79-6c95194171c0`, source `e4f794e`, on integration branch. Full SSD check/build/smoke and final HTTP48 checks pass; runtime hashes/API/auth/browser verified, compiled Mobile preserved. Real #4511 cancellation tested only on SSD copy; Production dialog opened and dismissed, receipt remains uncancelled. Protected profiles/revisions/cash/closing/match-learning/messages unchanged; concurrent operator amount/category/match edits are documented by decision audit. Report `/Volumes/SSD Files/SOLAO/line-bill-capture/releases/receipt-cancel-20261007/release-report.md`. No push or production-base advancement.


## Optional expense review note — 2026-10-07

Expense profile reason is optional for both draft and reviewed saves. Blank/omitted notes store status text (บันทึกร่าง or บันทึกว่าตรวจแล้ว) in immutable revisions; manual notes remain preserved. UI marks บันทึกการตรวจ (ไม่บังคับ). Type/length constraints, required factual fields and revision guards remain. The historical closed-round expense guard was superseded by the user on 2026-10-09. No schema or decision audit removal.

Optional note released SUCCESS caaf9846-ef01-498a-abb6-3c8d1e2009ce, source1c4e3e7. Runtime hashes, health and authenticated browser optional labels verified. No Production save performed; protected data unchanged between snapshots. Evidence in SSD releases/optional-review-note-20261007/release-report.md.


## Expense entry status — 2026-10-07

Desktop expense entry now says จัดข้อมูลค่าใช้จ่าย / กรอก / ตรวจข้อมูล and shows separate saved bill/slip states with outline icons and neutral/draft amber/reviewed blue chips. Existing expense-status batch cache drives entry through expenseStatusPaintEntry; successful saves refresh it without new per-document requests. Loading/error/unsupported view do not imply reviewed/empty. No financial, audit or closing logic changes.

Expense entry released SUCCESS18d2a64d-4e0a-4b0a-814f-cdf0fb7dcb2c, source550ba27. Authenticated Production UI, health and runtime hashes pass, no Production save or data change in compared pre/post snapshots. Evidence SSD releases/expense-entry-status-20261007/release-report.md.


## One expense profile review per pair — 2026-10-07

Exact 1bill+1slip pending/manual_review/confirmed pair now uses one canonical bill facts form and saved status, with both images as evidence. Existing GET items/:id/expense-profile accepts pair_match_id; PUT optional pair_context is strict {match_id,item_ids,expected_revisions}. Both member revisions are checked inside runWrite. Since the user instruction on 2026-10-09, closed own/anchor rounds do not block expense facts saves. Immutable revision evidence_snapshot_json stores pair_scope incl safe member identities. Slip profiles/history are preserved, never cloned/overwritten. Pair scope invalidates on changed/rejected match, membership/group or standalone slip revision; legacy bill-only reviewed requires explicit shared review. Selected-slip OCR proposals are scoped to selected pair. No match confirmation, amounts or ledger updates.

Expense-status/items optional match_ids (max400) adds by_match sibling of original data. Queue/header/entry uses one shared status and loading/error safe states. Confirmed shared preparation uses canonical bill facts; legacy slip conflicts are retained in history/read-only comparison. Original document counts and many-document form behavior remain compatible. Tests include strict context/auth HTTP14groups, immutable preservation, revision/closedround races, standalone legacy conflicts and real-copy54shared drafts. Node24 fullcheck/build/smoke pass. Evidence SSD releases/expense-pair-review-20261007. No new schema or profile backfill.

Shared pair workflow final release SUCCESS28915f2d-5323-4b5b-8f4d-c9df2a3ee1e0, source4ffbd17. Full SSDcheck/build/smoke, freshDB+images restore, scopedAPI/auth, runtime hashes and Productiononeform verified. No Productionprofilewrite; profiles5/revisions5 and protected financial/match tables unchanged pre/post. Live capture processing differences separately recorded. Evidence SSDreleases/expense-pair-review-20261007/release-report.md.


## Optional invoice product table and order references — Local, 2026-10-08

AI analysis JSON now retains optional line_items {line_no,description,product_code,quantity,unit,unit_price,amount}, line_items_complete, bill_subtotal_value (gross before discount including VAT when explicit), discount_value and partial metadata. Missing/unknown cells stay null; valid duplicate product rows survive; bounded malformed/oversized data is marked partial. Legacy OCR is not automatically rerun. No new DB table/migration. Current OCR product data stays in capture_items.ai_result_json and an immutable expense revision evidence_snapshot_json.invoice_details; it is not inventory, accounting allocation, a product master or proof of receipt.

invoice-details.js groups pages by LINE source + document ref + reliable supplier + normalized invoice date. Complete numbered pages are required before declaring product OCR complete; duplicate file hashes count once, conflicting page numbers cannot double-count products, limits and safe integer cents prevent false sums. Product sum is informational and compared to gross before discount, never added to net payable or used for matching. The expense table remains optional for draft/review: no new product requirement. Current fields/manual amounts remain authoritative. GET profile adds invoice_details + context_token; PUT optional invoice_context:{token} rejects stale page/OCR context inside the existing serialized write with409, preserving frontend drafts and allowing explicit evidence-only refresh. Snapshot includes optional table without claiming product verification. Product-based category proposals remain explicit adoption only; mixed is pending allocation under existing rules.

GET /api/admin/items/:id/order-product-reference?branch=<label>&date=<YYYY-MM-DD> reads dedicated market references only. BILL_ORDER_REFERENCE_BASE_URL (HTTPS), BILL_ORDER_REFERENCE_TOKEN and explicit BILL_ORDER_REFERENCE_BRANCH_MAP are server-only; unconfigured/failed/partial reads do not mean no order. Simulation rejects nonloopback upstreams. Date defaults to invoice date, explicit selected day is bounded +/-7 days and may differ from bill date. Exact branch/date scope, product_id+order_item_id provenance and original units remain separate from OCR names. Internal product codes are not supplier SKU aliases; multiple orders stay ambiguous; name matches are unconfirmed suggestions. No order/receipt/inventory write, quantity conversion, auto-adoption or durable mapping. Phase1 excludes PO/other-day carryover; market endpoint must be enabled separately on the approved current market runtime before real connection.

Desktop product table and order comparison are collapsed/optional. Source-only order adapter and market SELECT/auth HTTP fixture pass; LBC fullcheck/build/smoke + real copy trial pass. Real trial #3970/#3972 uses manually transcribed OCR test fixture, not a new AI call; source SHA, amounts/matches/cash/closing/messages unchanged. Test evidence SSD runs/2026-10-08T04-56-08-451Z-af670a5c and market-order-system/runs/2026-10-08T04-53-25-030Z-a2914437. No Production release/config/DB writes.
<!-- Desktop expense defaults, 2026-10-08 -->
ตารางสินค้า OCR เป็นข้อมูลเสริมย่อไว้ท้ายฟอร์ม. เดือนค่าใช้จ่ายเติมในร่างจากวันที่เอกสารที่ตรวจรูปแบบได้เฉพาะครั้งแรกเมื่อยังว่าง (พ.ศ.แปลง ค.ศ.) ห้ามใช้เดือนปัจจุบันแทนวันที่ไม่ทราบ ห้ามแทนค่าเดิม/เติมกลับหลังผู้ใช้เคลียร์/แก้รอบปิด และห้าม auto-save. การเทียบใบสั่งยังเป็นอ่านอย่างเดียว แยกจากการรับของ.
<!-- Expense form hierarchy, Local 2026-10-08 -->
Desktop form follows PROJECT_DESIGN.md: sequential nature/category, branch/period, parties; proposals are compact and explicitly adopted, provenance/reasons stay available in disclosures, optional note collapsed, OCR block always last. Preserve legacy dirty drafts, type-dependent required-field expansion, locks and pair guards. Shared CSS/JS follow-up is based on f41695d; no backend or Production change.

<!-- Verified Production invoice/desktop release, 2026-10-08 -->
Live deployment 8cde8c97-4433-427d-94f5-79d75e136b8d SUCCESS, integrated source cad0507. Controlled release from verified 28915f2d runtime; preserved all deployed Mobile compiled bytes. Full SSD check/smoke and Production runtime/health/auth/static/API/browser pass. Protected10-table before/after comparison unchanged. Fresh consistent DB+images restore verified; known pre-existing missing image645. Evidence: /Volumes/SSD Files/SOLAO/line-bill-capture/releases/invoice-expense-ui-20261008. No migration/backfill/expense save/AI re-read/config changes. Legacy #3970/#3972 page metadata is complete, but product OCR was not previously read (zero rows). Market endpoint and secret/branch-map remain pending separate deployment against current market base. Prior Local notes above describe rehearsal fixtures only.


## Expense facts remain editable after closing — 2026-10-09

User explicitly requires expense information to remain editable at all times, including closed bill/slip rounds. GET expense-profile returns edit_lock:null for compatibility; PUT and shared-pair save no longer reject a closed round. Draft/reviewed saves retain immutable revisions, decision actor binding, factual validation and optimistic standalone/pair/invoice concurrency checks. Expense saves do not reopen or alter daily closings, matches, cash payments or captured amounts. Receipt cancellation and financial/matching operations retain their own original closing rules. The desktop form supports manual entry, explicit proposal adoption and save without a closed-round banner; no automatic adoption/save. Assist status no longer claims all fields were filled when no eligible proposal exists. No schema/environment/new routes. Verification and release status recorded in CHANGELOG.

Expense always-editable rule released on approved Railway deployment `abb4d198-0107-4b9a-97e5-fc59ea3e0d81` SUCCESS, runtime `bba3c4a` (feature `d405b9a`, test fixture wait follow-up). Controlled SSD release `releases/expense-always-editable-20261009/` has153Git-equal source files plus8prior Mobile compiled files. Final full check/build/smoke passed SSD run09-41-44-382Z-370635fe;141runtime/test files equal tested snapshot. Fictional browser draft/reviewed saves+reload passed while7protected tables stayed identical. Production health/static43hashes and target #2335/#2345 GET confirm edit_lock:null with revision0/history0 unchanged and Sep1round stillclosed; bounded historical day/items/matches reads unchanged. Actual Production native form enabled controls, no closed banner. No Production expense save/reopen performed. Report in that release directory.


## Desk queue motion — 2026-10-09

Bottom queue selection keeps existing tile/highlight nodes when membership/content is unchanged, updates cur/aria-current only, and reveals selected tiles only when outside the visible strip. Preserve keyed focus on actual queue rebuilds. The highlight uses160ms ease-out without spring/stretch/selected-tile scale. Stage entry is a140ms opacity fade only on changed selection, with one cancellable timer; native async source refresh does not replay dock motion. Document viewer/confirmation motion and native financial handlers remain unchanged. No routes/schema/backend change. SSD browser/runtime evidence and release status in CHANGELOG and docs/DESK_VIEW_HANDOFF.md.

Desk queue motion released SUCCESS `610c47f9-801c-421a-9eb0-ac382df2e67d`, runtime `694dff6`. Controlled SSD releases/desk-queue-motion-20261009:153Git-equal source files+8prior Mobile compiled files,141runtime/test files equal final fullcheck/build/smoke SSD run10-07-55-546Z-009fb878; allbackendsource unchanged. Local36recordoverflow,34tile stability/rapid/manualscroll/keyboard tests pass (run10-02-01-827Z-ee6707dd). Actual Production Sep1Sankamphaeng Other2313/2317+done:11buttons/same lens across4trajectories, width96 throughout, noovershoot/dock motion/root drift, Arrow+Enter pass; writes=[]/JSerrors=[]. Health/static43hashes and bounded historicalAPI unchanged. Existing3322image404 remains separate. Evidence in release directory production-queue-retest-report.md.
