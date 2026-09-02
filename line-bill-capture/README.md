# LINE Bill Capture

Standalone LINE OA capture service. This app is deliberately separate from the market order system and uses its own database file under `CAPTURE_DATA_DIR`.

## What It Does

- Receives LINE webhooks at `POST /api/line-bill-capture/webhook`.
- Verifies `X-Line-Signature` from the raw body.
- Stores LINE group/room event history, text messages, image metadata, and raw event JSON.
- Downloads image message content into `CAPTURE_DATA_DIR/images`.
- Runs a separate AI worker that reads downloaded images, classifies bill/slip/notice/other, extracts totals, stores model confidence, and proposes bill-slip matches.
- Reads LINE context in the normal operational order: an image first, then the same sender's immediate typed details. The next image from that sender closes the context window.
- Matches candidates by amount first, then LINE group, sender identity, and time window. Every AI-created pair remains pending until a human reviews and confirms it; `AI_AUTO_MATCH_MIN_SCORE` only marks a proposal as high confidence.
- Remains silent for normal LINE traffic. It sends LINE only through an explicit admin **แจ้งให้โอน** action, or replies to exact `ตรวจบิล` requests in a separately allow-listed validation group.
- Marks unsent images/messages as `unsent` and deletes the stored image file when found.
- Marks byte-identical images as `duplicate` and keeps a pointer to the first stored item.
- Keeps bills without a readable total in `needs_amount` until the bill total is corrected.
- Serves authenticated desktop `/admin` and mobile `/m2`/`/m3` UIs. A private access link creates the session, then the operator selects a named card for the audit log.
- Stores owner-approved category/pair corrections as in-context examples. This is not model fine-tuning, and AI can never move a pair directly into the completed state.

## Railway

Set these variables in Railway:

```env
LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN=...
LINE_BILL_CAPTURE_CHANNEL_SECRET=...
# Optional stable labels keyed by LINE group source_id.
LINE_BILL_CAPTURE_GROUP_LABELS='{"group:C...":"Example group"}'
CAPTURE_DATA_DIR=/data

# AI worker. OPENAI_API_KEY is required for real OCR/vision.
AI_WORKER_ENABLED=auto
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5.6-terra
OPENAI_IMAGE_DETAIL=high
AI_WORKER_START_DELAY_MS=2000
AI_WORKER_STALE_PROCESSING_MS=30000
AI_AUTO_MATCH_ENABLED=true
AI_AUTO_MATCH_MIN_SCORE=90
AI_SEQUENCE_MATCH_MIN_SCORE=50
AI_MATCH_REQUIRE_SAME_SOURCE=true
AI_MATCH_AMOUNT_TOLERANCE=5
AI_MATCH_PERCENT_TOLERANCE=0.02
AI_MATCH_MAX_HOURS=48
```

Mount a persistent Railway volume at `/data`.

If `OPENAI_API_KEY` is not set, the capture service still records LINE history and images but the AI worker stays disabled. The worker uses OpenAI's Responses API with image input and sends local stored images as Base64 data URLs.

Set the LINE webhook URL to:

```text
https://<your-railway-domain>/api/line-bill-capture/webhook
```

Admin URL:

```text
https://<your-railway-domain>/admin
```

Current participant roles, learning metrics, and known limitations are documented in
[`docs/AI_LEARNING_STATUS.md`](docs/AI_LEARNING_STATUS.md). Human/Shadow action boundaries are in
[`docs/DECISION_ACTION_REGISTRY.md`](docs/DECISION_ACTION_REGISTRY.md).

Admin AI endpoints:

```text
GET  /api/admin/ai/status
POST /api/admin/ai/run
POST /api/admin/ai/rematch
POST /api/admin/items/deduplicate
```

## Local

```bash
cd line-bill-capture
npm install
cp .env.example .env
npm start
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Run local smoke tests:

```bash
npm run check
npm run smoke
```

The smoke test uses `AI_PROVIDER=mock` and `LINE_CONTENT_MOCK_DIR` so it can verify the AI/OCR pipeline and auto-match flow without calling external AI or LINE content APIs.

Webhook signature smoke test:

```bash
BODY='{"destination":"test","events":[]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$LINE_BILL_CAPTURE_CHANNEL_SECRET" -binary | openssl base64)
curl -i -X POST http://127.0.0.1:8000/api/line-bill-capture/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: $SIG" \
  --data "$BODY"
```

## Deploy Guardrail

This directory must be deployed as the Railway service root:

```bash
railway up --detach --service line-bill-capture --environment production --path-as-root .
```

Do not deploy the repository root to this service. The root contains the separate market order app.
