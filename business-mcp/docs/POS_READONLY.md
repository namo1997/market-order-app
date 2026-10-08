# ClickHouse POS detail candidate — 8 October 2026

This is implemented, tested code **not deployed or live validated**. Existing production summary is still the Market Order AS_REPORTED report. No production variables, business data or services were changed.

## Source and release base

Worktree `/workspace/business-pos-readonly-oct8`, branch `business/pos-readonly-20261008`, base `0c49016b18407c2778a63df55d75c8111268bafd` in `namo1997/market-order-app`. This integration head differs from production-base `cec755f9a8ee93f0844a6c8f0f2c9deda487c0fe` only in README/CHANGELOG; all 15 released HR/business tools remain. Repository CHANGELOG ties the active `c40afa36-1888-4902-bbf4-aa15048fb427` release to that production base; this is release evidence, not an SSH runtime-hash verification here. Recheck remote refs and active deployment before release. Package/server version stays `0.1.0`; response schema is `1.0`.

Provider evidence: `general-cashflow/server/src/clickhouse.js` at this base confirms `doc`/`docpayment`, `transflag=44`, cancel flag, `coalesce(guidbranch,branchid)`, FINAL and explicit Asia/Bangkok date conversion. `server/src/controllers/reports.controller.js` confirms `docdetail` usage; `AI_DATABASE_SCHEMA.md` is a dated reference, **not live schema/enum proof**. Its branch ID labels are reversed relative to the Oct8 live branch directory: do not copy those labels. Seller-to-receipt relationship and delivery/paytype classification remain unverified.

## Contracts and model flow

Read `business_describe_sources` / `business_get_overview` first. Existing `business_read_sales` stays AS_REPORTED and is not a transaction oracle.

- `business_pos_list_receipts`: required `branch`; optional `from`, `to`, `limit` (1–100/default20), signed `cursor`, `classification` (ALL/STOREFRONT/DELIVERY/UNCLASSIFIED; default ALL), `cancel_status` (ACTIVE/CANCELLED/ALL; default ACTIVE), `time_from`/`time_to` (HH:MM:SS Bangkok, no overnight wrap), exact `product_barcode`, exact `payment_description`. Product/payment filters use branch-scoped subqueries, never a line × payment join.
- `business_pos_read_receipt`: required `branch`, `docno`; optional dates, limit and cursor. It returns one header plus pages of lines and payment entries. Re-read/restart on source revision change.

All 17 tools retain OAuth `business.read`. New detail reads additionally require `allow_pos_details:true` on the existing client. Client branch/date policy runs before any schema/data request. Date window remains at most 32 inclusive calendar dates. Native branch ID comes only from `BUSINESS_BRANCH_MAP_JSON.clickhouse_branch_id`, never user input. Current verified directory IDs: KK `2PdQF0n9TADAVUEV2dDeqOo7D9N`; SK `2PxT0SwTMlORbcER7eaIqi08v4k`. Keep existing market/HR/Cash/LINE mappings and policy unchanged.

Outputs carry source/read_only, requested sale-date window/timezone, read `as_of`, `source_updated_at:null`, observed engine/sorting/primary keys, available projected fields, pagination/coverage, classification, and limitations. Monetary/quantity values remain source decimal strings; no float sum or invented net/VAT/refund formula. Optional absent fields are null. Seller is null/UNVERIFIED. No HR-name join is added. Receipt identity uses authorized shop/branch/docno; any reused/duplicate header across dates is rejected before child joins. Lines require unique non-null line_number. Payments preserve source rows, do not infer an immutable individual payment ID.

This is **POS detail, not a proven storefront-only ledger**. Empty deliverycode or non-delivery payment is not assumed to mean storefront. Configure reviewed exact `(deliverycode,paytype)` mappings with evidence before STOREFRONT/DELIVERY filters. Unknown remains UNCLASSIFIED; classified filters fail closed if no mapping exists. Other transflags/refunds and verified seller fields require further source facts; they are not silently included or fabricated.

## Minimal runtime configuration delta

Configure only on the gateway service `4cf6fa47-ca71-4c2b-a3de-fb78f3988e1f`, project `a7a9dbdd-f560-476f-98f4-119330c90e57`, environment `8dd3216f-43c5-406c-8cac-c13519a42361` through Railway sealed variables/reference expressions or the Cloud/client secret store. Never paste secret values into chat.

| Variable | Required value/purpose |
| --- | --- |
| BUSINESS_POS_CLICKHOUSE_URL | Reviewed existing HTTPS ClickHouse HTTP origin, no credential/query/path |
| BUSINESS_POS_CLICKHOUSE_DATABASE | Reviewed database identifier (dated docs say dedebi; probe verifies) |
| BUSINESS_POS_SHOP_ID | Reviewed shop ID; required on every business SELECT |
| BUSINESS_POS_CLICKHOUSE_USER | Existing legitimate purpose-specific read-only identity |
| BUSINESS_POS_CLICKHOUSE_PASSWORD | Sealed secret/reference for that identity |
| BUSINESS_POS_CURSOR_KEY | New gateway-local random secret >=32 characters, sealed; do not reuse OAuth/source credentials |
| BUSINESS_POS_CLASSIFICATION_JSON | Optional exact reviewed code mapping list `{deliverycode,paytype,classification,evidence}`; default [] |

Add `clickhouse_branch_id` to each existing branch record and `allow_pos_details:true` only for authorized clients, preserving all other fields. There is no new route or unprotected API: reuse authenticated `/mcp`. No MySQL credential/binding is needed. No schema migration, ingestion, refresh or sync.

Railway supports `${{exact-service-name.EXACT_VARIABLE_NAME}}` references, so a known eligible existing read-only ClickHouse secret can be shared server-side without reading its redacted value. **Eligibility and exact service names must be verified before binding; existing Market/Cash database account grants are currently unknown. Do not share an unverified writable/admin credential.** `CLICKHOUSE_*` on Market and `CASHFLOW_CLICKHOUSE_*` on Cash are source connection namespaces, not proof of a read-only role. Variable changes normally redeploy; do not apply them before release approval. No credential was extracted here.

## Schema and resource gates

HTTP GET SELECT only, bound ClickHouse parameters, readonly=1, max execution5s, max rows read1,000,000, max result rows1002 with overflow throw, response2MB, timeout10s, no redirects. No tool accepts SQL, database identifiers, URL or settings. Credentials are headers, never URL/query or output. Transport errors suppress upstream body/URL. Only fixed system metadata SELECTs and reviewed projections are used. Plain MergeTree gets no FINAL; ReplacingMergeTree gets FINAL. Other engines or missing required columns/branchid reject the read. Optional fields appear only when metadata confirms them; projected absent values are null. Header pages use nanosecond timestamp+docno keyset; signed15min cursors bind operation/client/branch/date/filters. Detail reads cap1000 lines and1000 payment rows; above this bound returns an explicit error, not incomplete data disguised as complete. Pages are live reads, not a database snapshot; restart if detail revision changes. No overall totals are fabricated from partial pages.

## Verification and next gate

Cloud runtime reports no secret bindings/outbound identities; Railway tools redact values and expose no supported runtime-command executor here. Legacy ClickHouse connector remains unavailable at its old endpoint. Consequently **no direct live schema/header/line/payment read has passed for this candidate**. The existing production sales report is a separate already-connected read path.

Run `npm ci --ignore-scripts`, `npm test` on this source. Run `BUSINESS_VERIFY_CLIENT=<existing authorized name> node scripts/verify-pos.mjs KK SK` only in an executor with legitimate configured bindings. It uses real source reads, never fixture fallback, and prints only source status/provenance/window—not docnos, amounts, items, people or tokens. Empty periods cannot prove receipt detail; the report marks detail_read=false. Then, after approved deployment, use a real authorized MCP client to initialize/list the17tools, list1header per branch, read its1page detail, test scope rejection and cursor continuation without exporting raw payloads.

Cloud fixture/protocol tests do not satisfy the AGENTS SSD release check or live-source gate. AGENTS line7 requires SSD `ssd-workspace.mjs check`/`run`; that helper and mounted SSD are absent in this Cloud environment, and the Mac plugin was uninstalled. Parent approved isolated Cloud tests under the user's implementation/testing authorization. AGENTS line8 explicitly says “ก่อน deploy ต้อง commit, ขออนุมัติผู้ใช้”; satisfy this final release gate with concrete reviewed commit/config and an available approved test executor. No deployment was performed.

### Reviewed metadata probe in existing source runtime (no deploy)

Discovery confirmed service `market-order-app` ID `0ccd425e-d8c0-4c6d-b7f0-164081168902` has existing `CLICKHOUSE_HOST/PORT/SECURE/DATABASE/USER/PASSWORD/SHOP_ID/TZ_OFFSET` bindings; `general-cashflow` ID `76c12906-b046-4b99-a3fc-bf08f559ce73` has corresponding `CASHFLOW_CLICKHOUSE_*`. Values and grants were not read.

An owner executor with registered Railway SSH key can run the reviewed standalone probe without importing/starting the application, editing runtime configuration or deploying:

```sh
railway ssh --project a7a9dbdd-f560-476f-98f4-119330c90e57 --environment production --service 0ccd425e-d8c0-4c6d-b7f0-164081168902 -- node --input-type=module < business-mcp/scripts/probe-pos-metadata.mjs
```

The script uses only the existing source runtime binding and fixed metadata GET SELECTs (`system.columns`, engines/keys, session readonly, direct grants and inherited role count); prints no credentials, endpoint or business rows; no source mutation. It preserves the source's existing transport setting and reports whether HTTPS is configured. The candidate gateway requires HTTPS. Direct-grant metadata and session readonly=1 do not prove permanent read-only account grants; inherited roles need owner review. If existing credentials are writable/unverified, provision a scoped reader binding in the secret store rather than share them. Supported SSH was unavailable in this agent's current Cloud/MCP tools, so this probe **was not executed live here**. See [Railway SSH](https://docs.railway.com/cli/ssh) and [service variable references](https://docs.railway.com/variables#referencing-another-services-variable).

After account/transport verification, example server-side references are `${{market-order-app.CLICKHOUSE_DATABASE}}`, `${{market-order-app.CLICKHOUSE_USER}}` and `${{market-order-app.CLICKHOUSE_PASSWORD}}`. Construct a reviewed HTTPS origin using the eligible HOST/PORT reference; do not silently promote an HTTP endpoint to HTTPS. These are a proposed configuration delta only. Existing direct endpoint/grants may require a different dedicated reader profile; no references were applied.
