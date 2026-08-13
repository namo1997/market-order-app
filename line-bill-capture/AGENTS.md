# AGENTS.md — line-bill-capture

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
- Always run `npm run check && npm run smoke` before deploying.
- `railway.json` requires `/health` to pass before Railway promotes a new deployment.

## 3. Stack & how to run

- **Runtime:** Node.js 24 (ESM, `"type":"module"`), Express. **No build step, no framework, no TypeScript.**
- **DB:** native file-backed SQLite via Node's built-in `node:sqlite`, in WAL mode. One writer
  at a time remains serialized by the in-process `writeQueue`. `db.js` keeps a small
  sql.js-compatible statement adapter so existing query helpers retain their
  `step()` / `getAsObject()` contract without loading or exporting the whole database in RAM.
- **Frontend:** one self-contained file `public/index.html` (dense, near-minified inline JS/CSS).
  No bundler. Served statically.
- **AI:** OpenAI Responses API vision model (`AI_PROVIDER=openai`), or a filename-based
  fake (`AI_PROVIDER=mock`) used by tests.

```bash
npm run dev      # node --watch src/server.js
npm start        # node src/server.js
npm run check    # node --check on server.js, db.js, smoke-test.mjs
npm run smoke    # end-to-end test with mock AI (spins up a throwaway server)
```

Local dev: copy `.env.example` → `.env`. Default `PORT=8000`. Admin UI at `/admin`.
Run `npm run preview:sync` to copy a consistent SQLite snapshot and all captured images from the
Railway volume into ignored `.local-preview/data`, then `npm run preview` and open
`http://localhost:8010/admin`. The local server uses only that copy: confirm/edit actions mutate
the local database and never reach production. Sync again whenever a fresh production snapshot is
needed; syncing replaces local preview changes.

## 4. Environment variables

| Var | Purpose |
|---|---|
| `PORT`, `HOST` | Listen address (default 8000 / 0.0.0.0). |
| `CAPTURE_DATA_DIR` | Data root. **Production = `/data` (Railway volume).** Holds the sqlite file + `images/`. |
| `CAPTURE_DB_PATH` | Optional explicit sqlite path (default `<CAPTURE_DATA_DIR>/line-bill-capture.sqlite`). |
| `LINE_BILL_CAPTURE_CHANNEL_SECRET` | LINE webhook signature verification (HMAC-SHA256). |
| `LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token (download image content, fetch sender profiles). |
| `LINE_BILL_CAPTURE_PUSH_MOCK` | `1` makes explicit admin push actions record a simulated send without contacting LINE. Forced on by `npm run preview`. |
| `LINE_BILL_CAPTURE_GROUP_LABELS` | JSON map `{ "<groupId>": "ชื่อกลุ่ม" }` for display names. |
| `LINE_BILL_CAPTURE_VALIDATION_GROUPS` | JSON map of groups allowed to run a summary-cover check and receive a reply after the exact text `ตรวจบิล`; example `{ "<groupId>": { "mode": "bill_summary", "supplier": "เจ๊แววไก่สด", "reply_enabled": true } }`. Empty by default, so every group remains silent. |
| `LINE_CONTENT_MOCK_DIR` | Test-only: read image bytes from local files instead of LINE API. |
| `AI_PROVIDER` | `openai` (real) or `mock` (tests). Empty + no key = AI disabled. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_DETAIL`, `OPENAI_MAX_OUTPUT_TOKENS` | OpenAI config. Summary covers with many rows may need `OPENAI_MAX_OUTPUT_TOKENS` around 3000. |
| `AI_COST_USD_THB_RATE`, `AI_INPUT_USD_PER_MILLION`, `AI_CACHED_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION` | Admin-header cost estimate. Defaults use 35 THB/USD and the known `gpt-5.6-luna` standard token rates; override them when exchange rates or model pricing changes. Reasoning tokens are already included in output and are not charged twice. |
| `AI_WORKER_ENABLED` | `auto` (on if configured) / true / false. |
| `AI_WORKER_INTERVAL_MS`, `AI_WORKER_START_DELAY_MS`, `AI_WORKER_BATCH_SIZE`, `AI_WORKER_MAX_ATTEMPTS`, `AI_WORKER_STALE_PROCESSING_MS`, `AI_MAX_IMAGE_BYTES` | Worker loop tuning. |
| `AI_ANALYSIS_CONCURRENCY` | Number of vision analyses allowed concurrently inside one worker cycle (default 1, maximum 5). Keep at 1 when strict chronological image-summary context matters; local bulk reprocessing may use 3. |
| `AI_TEXT_CONTEXT_WINDOW_MS`, `AI_TEXT_CONTEXT_LIMIT` | How much nearby same-sender typed text to feed the vision model (default 30 min / 10 msgs). |
| `AI_CONVERSATION_CONTEXT_WINDOW_MS`, `AI_CONVERSATION_CONTEXT_LIMIT` | Ordered all-sender LINE group timeline sent to the vision model (default ±6 hours / nearest 15 messages). Nearby analyzed images are represented by their stored AI summaries. |
| `AI_AUTO_MATCH_ENABLED`, `AI_AUTO_MATCH_MIN_SCORE` | Auto-confirm a match at/above this score (default 90). |
| `AI_SEQUENCE_MATCH_MIN_SCORE` | Minimum score to even propose a candidate pair (code default 50; production is set to 55). Setting it very low floods the review queue with junk candidates. |
| `AI_MATCH_AMOUNT_TOLERANCE`, `AI_MATCH_PERCENT_TOLERANCE`, `AI_MATCH_MAX_HOURS`, `AI_MATCH_REQUIRE_SAME_SOURCE` | Matching heuristics. |
| `AI_MATCH_SOURCE_FALLBACKS` | JSON map from a slip's primary group to bill groups searched only as a fallback. Cross-group fallback pairs always require human confirmation. |
| `ADMIN_PIN` | **Required.** Shared PIN for the admin. Set in Railway Variables; never commit it. Admin is locked (503) until set. |
| `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_HOURS`, `ADMIN_MAX_FAILS`, `ADMIN_LOCK_MINUTES` | Session key (random per boot if unset), session length, and the login rate limit. |

Secrets are never committed. `.env` and `.env.*` are in `.gitignore` and `.dockerignore`.

## 5. Data model (SQLite tables)

- **`capture_items`** — one row per received image (bill or slip). The core table.
- **`capture_matches`** — a bill↔slip pairing with score/status/reasons.
  Rows sharing `match_group_key` form one aggregate transaction, allowing one bill paid by
  several slips or several bills paid by one slip. Aggregate totals must deduplicate member IDs.
- **`ai_learning_examples`** — owner-approved confirmed/rejected pair examples. These are injected
  into later vision prompts as operational hints; they are not external model fine-tuning.
- **`capture_daily_closings`** — per (business_date, source_id) daily close record + summary snapshot.
- **`line_messages`** — every chat message (text/image/etc). Text messages are the source of the "typed context".
- **`line_senders`** — per-group sender profile (display name, picture) from LINE.
- **`line_groups`** — known groups + counts.
- **`line_events`** — raw webhook event log (idempotency via `webhook_event_id`).
- **`line_group_validation_requests`** — one-shot `ตรวจบิล` requests; a request is replied only after the configured group's summary cover and detail bill amounts match.
- **`line_transfer_requests`** — audit trail for each explicit admin **แจ้งให้โอน** action. Status is `sent`, `mock_sent`, or `failed`; stores the bill, target group, exact message, actor, and timestamps.

### Key `capture_items` columns & enums

- `category`: `pending` | `bill` | `bill_page` | `transfer` | `transfer_notice` | `other`  (transfer/transfer_notice = "slip")
- `status`: `received` | `downloaded` | `download_failed` | `unsent` | `duplicate`
- `match_status`: `unmatched` | `pending` | `confirmed` | `rejected` | `needs_amount`
- `ai_status`: `pending` | `processing` | `done` | `failed`
- `bill_total_value` / `slip_amount_value` — numeric amounts (from image OCR, or typed text for bills).
- `supplier_name` — canonical supplier name extracted from the current summary cover; detail-bill OCR names never overwrite it.
- `document_class` in `ai_result_json`: `bill_summary_cover` (the source-of-truth cover), `bill_summary` (an aggregate/cash-sale summary that must not count as a detail bill), `standard_bill`, `bill_continuation`, `transfer_slip`, or `other`.
- `announced_amount` — numeric amount explicitly typed in nearby chat for a bill, kept separately from the document/OCR amount.
- `bill_purpose` — what a bill is FOR, from the chat announcement (e.g. "ค่าเนื้อ", "ค่าผัก"). Bills only.
- `payment_role`: `ordinary_payment` | `advance_payment` | `reimbursement`. The latter two describe
  an employee/person paying a business expense first and Solao repaying that person.
- `reimbursement_related_item_id` links the advance-payment slip and reimbursement slip in both
  directions. `reimbursement_status` is `unmatched` or `pending`; AI-created links wait for review.
  `reimbursement_reason_json` records the amount/purpose/time evidence.
- `reimbursement_status` can become `confirmed` after review. `reimbursement_evidence_mode` is
  `existing_receipt`, `receipt_substitute`, or `not_required`; the last option requires a stored
  `reimbursement_review_note`. Reviewer and timestamp are stored in `reimbursement_reviewed_by` /
  `reimbursement_reviewed_at`.
- `amount_review_flag` (0/1) — set when the amount typed in chat disagrees with the amount on the document. Flagged pairs are **never auto-confirmed**; a human must review.
- `flag_resolved_at` / `flag_resolved_by` — audit fields written when an admin clears an amount flag, including when the announced amount is applied to the bill.
- `category_edited_at` / `category_edited_by` — records a human category correction. Full AI resets preserve these owner-taught examples.
- `category_edit_reason` — the admin's typed explanation for a manual category correction such as **ไม่ใช่บิล** / **ไม่ใช่สลิป**.
- `doc_ref` / `page_no` / `page_count` — multi-page invoices. `doc_ref` is the tax invoice number,
  printed identically on every page, and is what groups the pages together.
- `vendor_tax_id` — normalized 13-digit tax ID printed on a bill. It is used with `doc_ref` and
  the payable amount to detect the same invoice sent again even when the image bytes differ.
- `duplicate_of_item_id` — points to the first identical image (dedup by `file_sha256`).
- `event_timestamp_ms` — LINE event time (ms). Basis for the business date (see §7).
- `ai_input_tokens` / `ai_cached_input_tokens` / `ai_output_tokens` /
  `ai_reasoning_tokens` / `ai_total_tokens` — usage returned by OpenAI for that image analysis.
  Older rows remain null; `/api/admin/ai/status` reports aggregate tracked usage under
  `queue.token_usage`. Do not estimate monetary cost without an explicit model price.
- `generated_document_type` / `generated_document_json` / `generated_from_item_id` — audit data
  for an admin-created document. `receipt_substitute` is a bill generated from one unmatched slip;
  the JSON stores payer, payee, destination account, description, date, amount, and document number.
  `batch_payment_summary` marks a source image containing several supplier payments, while each
  payable row becomes a generated `batch_payment_line` bill linked back through
  `generated_from_item_id`. Excluded/handwritten "จัดรวม" rows stay only in the parent JSON and
  are not counted as payable items.
- A match can store `review_note`, `ai_learning_approved`, `reviewed_by`, and `reviewed_at`.
  Approval requires a non-empty note and creates/updates one `ai_learning_examples` row per match.

## 6. Core flows

1. **Ingest:** `POST /webhook` → verify LINE signature → durably insert every raw event/message
   and every image's `capture_items(status='received')` metadata → respond 200 → `processEvents`
   (setImmediate). A pre-ack database failure returns 500 so LINE can redeliver; never move the
   200 response ahead of durable metadata writes. Image messages then download bytes
   (dedup by sha256) → `capture_items` with `status='downloaded'`. Text messages → `line_messages`.
   Content download retries three times. On startup, the service scans `status='received'` rows
   and resumes their downloads from `raw_event_json`, covering a crash after acknowledgement.
   `/health` exposes `ingest.last_event_at`, event count, pending downloads, and failed downloads.
   If an old webhook gap must be recovered, `scripts/import-line-chat-export.mjs` imports a LINE
   desktop text export plus an exactly ordered image directory. It creates stable synthetic event,
   message, and sender IDs, so rerunning the same date range is idempotent. Expired LINE media may
   be recovered from the desktop viewer thumbnails, but must be labeled in `raw_event_json.import`
   as `expired_line_desktop_thumbnail`; it remains real evidence at reduced quality and enters the
   normal AI queue. The importer creates a consistent SQLite backup before writing and never sends
   or replies to LINE.
2. **AI worker** (`ai-worker.js`, runs on an interval): claim `downloaded`+`ai_status=pending`
   items → gather **nearby typed text** from the same sender (`listNearbyText`) plus an ordered
   all-sender group timeline (`listNearbyConversation`) → send image + both contexts to the vision
   model (`buildVisionPrompt`) → `applyAiAnalysis` writes category,
   amounts, `announced_amount`, `bill_purpose`, `amount_review_flag`, etc. → `autoMatchAiPairs` proposes/creates
   matches.
   For groups listed in `LINE_BILL_CAPTURE_VALIDATION_GROUPS`, the worker treats the first image in the current cycle as a source-of-truth `ใบรับวางบิล` / summary cover, takes the canonical supplier name from that cover, then accepts supplier-specific detail formats (receipt, invoice, delivery note, handwritten form, cash sale). Aggregate/cash-sale summaries are kept as evidence but excluded from the detail count. It matches cover rows by document reference when both sides have one, then uses amount/date, then amount-only fallback. Duplicate amounts remain separate rows. It only sends a LINE message when a user has first typed exactly `ตรวจบิล` and the counts, duplicate amounts, and totals all match. An incomplete AI result or mismatch produces no LINE message.
3. **Matching** (`scoreSequencePair`): score by amount closeness + same group + time gap +
   AI confidence. `>= AI_SEQUENCE_MATCH_MIN_SCORE` → candidate; `>= AI_AUTO_MATCH_MIN_SCORE`
   AND not flagged → auto-`confirmed`, else `pending`. One bill ↔ one slip (greedy by score).
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
4. **Admin review** (`/admin`): the home screen is a monthly operations dashboard with
   previous/current/next month navigation. It shows four workload totals, a full-width 7-column
   calendar, and a detailed round table sorted with open/high-workload rounds first. Every calendar
   date lists its LINE groups separately with `ค้าง`, `พร้อม`, or `ปิดแล้ว`, so selecting a group
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
   An unmatched bill also exposes **แจ้งให้โอน**. It opens an editable confirmation modal and only
   pushes the confirmed text to that bill's original LINE group through
   `POST /api/admin/items/:id/request-transfer`. This is an explicit admin action, never an
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
- When an admin recategorises an item into a non-matchable category (anything other than `bill`,
  `transfer`, or `transfer_notice`), every active pair containing that item is rejected and both
  items return to `unmatched`; never leave a stale pair behind.

### Cross-day transfers (โอนข้ามวัน) — common, ~33% of production matches
A bill posted on day X is often paid by a slip on day X+1 (the matcher allows `AI_MATCH_MAX_HOURS`,
default 48h, so it pairs them at ~85 → **pending**, i.e. a human reviews it).

- **A pair belongs to the BILL's day** (the expense day). `listDays` therefore counts
  `confirmed_count`/`pending_count` **on bills only** — otherwise one pair would count as work on
  two different days. A slip whose bill sits on another day contributes nothing to its own day's
  workload (that day can still show `slip_count`, and reads as 100%/พร้อมปิด if it has no work).
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
- **The day view keeps a wider lookup pool.** `data()` fetches items for the scoped day **±2 days**
  into `S.pool` and derives the day-scoped `S.items` from it. `item()` and the slip picker read
  `S.pool`; buckets/counters read `S.items`. Without this the counterpart of a cross-day pair is
  `undefined` — the review panel renders no slip image or amount, and the slip picker offers
  nothing. If you change the pool width, keep it ≥ `AI_MATCH_MAX_HOURS`.
- **A late slip reopens a closed day.** `setItemMatch` calls `reopenClosedDayForItem` for the bill,
  so pairing a bill whose day was already closed flips that closing back to `status='open'` and
  records `reopened_at` / `reopened_reason` (the snapshot taken at close is stale once the pair
  exists). The board shows a red "เปิดใหม่อัตโนมัติ" chip and the day view a banner, so the day is
  never silently reopened; closing again clears both markers and refreshes the snapshot. Closing a
  day that still has bills without slips warns about exactly this.

### Multi-page bills (ใบกำกับหลายหน้า)
Wholesaler invoices (Makro et al.) are photographed one page at a time and **only the last page
carries the payable grand total**; earlier pages just list items and say "มีต่อหน้า N".

- `applyAiAnalysis` demotes a `bill` with `page_count > 1` and no positive total to
  **`category='bill_page'`** — a continuation page. This keeps it out of `needs_amount`
  (it has no amount to enter, so it would be an unresolvable phantom task) and out of matching.
  The existing `IN ('bill','transfer','transfer_notice')` whitelists already exclude it.
- The prompt forbids promoting a line item/subtotal to `bill_total_value` on a page with no
  final total — better a null total than a wrong match.
- The day view groups pages by `doc_ref`: the review panel shows the other pages of the same
  invoice as thumbnails, and an **`orphan_page`** bucket lists pages whose invoice has no payable
  page yet (i.e. someone forgot to photograph the last page). Orphans DO count as work.

## 7. Business date invariant (do not break)

An item's "day" = **Asia/Bangkok** calendar date of `event_timestamp_ms`
(fallback: first 10 chars of `created_at`). This MUST be computed identically in two places,
or the day board and the scoped queue disagree:

- **SQL:** `matchBusinessDateSql()` in `db.js` →
  `date((event_timestamp_ms/1000)+25200,'unixepoch')` else `substr(created_at,1,10)`.
  Used by `listDays`, `listItems` start/end filter, `listMatches` start/end filter, day closings.
- **Frontend:** `dateOf()` in `index.html` → `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'})`.

Never filter items/matches by raw UTC `created_at` for date scoping — it drifts near midnight Bangkok.

## 8. HTTP API

Public: `GET /health`, `POST /webhook` (+ aliases `/api/webhook`, `/api/line-bill-capture/webhook`),
`GET /` → redirect `/admin`, `GET /admin` (+ static assets). The admin page route
`GET /admin/day-report?date=YYYY-MM-DD&group=...` renders the printable A4 report only when that
day/group closing is currently `closed`; `autoprint=0` suppresses the automatic print dialog for review/testing.

Admin (`/api/admin/*`, JSON):
- `GET ai/status`, `POST ai/run`, `POST ai/rematch`, `POST ai/reset-all` (re-reads non-manually-classified downloaded images and resets AI-created pairs; optional JSON `start`/`end` scopes the reset by Bangkok business date, and `source_id` limits it to one LINE group. The admin UI only ever calls it with one day + one group, and hides the button outside the day view, because a wider reset undoes confirmed AI pairs across groups)
- `GET days`, `POST days/close`, `POST days/reopen`
- `GET items` (supports `flagged=1` and returns `flagged_count`), `PATCH items/:id` (including cover `supplier_name` correction), `PUT items/:id/category`, `GET items/:id/image`, `GET items/:id/context`, `POST items/deduplicate`, `POST items/:id/resolve-flag` (clear, manually set, or apply announced bill amount)
- `GET items/:id/receipt-substitute-draft` (prefill from an unmatched slip), `POST receipt-substitutes` (create an idempotent manual bill and confirm it against that slip)
- `GET messages`, `GET senders`, `POST senders/refresh`, `GET groups`, `GET matches`, `POST matches`

Message/context responses include `capture_item_id` when an image message has a stored
`capture_items` row. The admin chat timeline uses this ID with the item image route, so image
events render as the original captured image instead of `[image]` text.

**Auth: BUILT BUT NOT ENABLED.** `src/auth.js`, `/api/auth/login` and `/api/auth/logout` all exist
and work, but the gates on `/admin` and `/api/admin` are **commented out** in `server.js` at the
owner's request (PIN is the last thing to switch on). **The admin is currently open to anyone with
the URL.** To enable: uncomment `requireAuthPage` on the two `/admin` mounts and `requireAuthApi`
on `/api/admin`, restore the anonymous-401 assertion in the smoke test, unhide the `#logout`
button, and set `ADMIN_PIN` on Railway **before** deploying (it fails closed with 503).

When enabled, it behaves as follows (shared PIN, `src/auth.js`). `/health` and
`/webhook` stay open — LINE must reach the webhook, and it is signature-verified instead.
`POST /api/auth/login` (PIN → signed HttpOnly cookie) and `POST /api/auth/logout` are open.
**Fails closed:** with no `ADMIN_PIN` set the admin returns 503, it never falls back to open.

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
  "เลือกสลิป" there. `renderChatPanel()` fetches up to 200 messages in a ±6 hour window through
  `GET items/:id/context`; keep its scrolling inside `#chatlist` so the day backbar stays visible.
  The "ค้าง N" tag = review + needs_amount + slip + bill, and **must reconcile with the board's
  `ค้าง`** — so `other` (AI junk) and duplicates are deliberately excluded from work counts.
  Keep both sides in sync if you change either counting rule (see `listDays` in `db.js`).
- CSS gotchas:
  - Author rules like `.layout{display:grid}` override the `[hidden]` attribute, so there is a
    `[hidden]{display:none!important}` reset — keep it.
  - `.empty` is a **global empty-state class with `min-height:320px`** — never reuse that word as
    a modifier on small elements (a zero-count chip modifier is `.zero` for this reason).
- `group()` labels come from `/api/admin/groups` (env `LINE_BILL_CAPTURE_GROUP_LABELS`), with a
  hardcoded `GROUP_NAMES` fallback for two known groups.

## 10. Testing

- `npm run smoke` boots a throwaway server with `AI_PROVIDER=mock` and drives the full pipeline
  (webhook → download → dedup → AI → match → reassign → unsend). Extend it when adding behavior.
- The mock analyzer keys off the message id / filename (`slip`, `bill`, `bill-alt`, `bill-noamount`)
  and, for bills, parses amount/purpose from the injected nearby text.
- Always run `npm run check` (syntax) + `npm run smoke` before deploy.

## 11. Known state / TODO

- **Auth is a shared PIN, not per-user.** There is no audit trail of *who* did what beyond
  `admin-web`. The PIN is low entropy, so the login rate limiter in `src/auth.js` is load-bearing —
  do not remove it. Tests must sign in (see `signIn()` in `scripts/smoke-test.mjs`).
- **Prod `AI_SEQUENCE_MATCH_MIN_SCORE=1`** — should be 50–60 to stop junk candidate pairs.
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
- LINE remains silent by default. The only enabled reply path is an explicit `ตรวจบิล` request in a group configured in `LINE_BILL_CAPTURE_VALIDATION_GROUPS`; the reply is sent to that same group. No other captured group receives an automated message.

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
