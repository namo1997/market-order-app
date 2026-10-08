# Chat-only metadata diagnostic — review before approval

This candidate enables a supported chat workflow after an approved release. It has not been deployed. It requires no owner terminal/SSH, no secret-value extraction and no new plugin tool input. Existing authenticated `business_describe_sources({})` gains an optional `pos_connection` only for the configured operator when the explicit metadata flag is on. All other clients receive the catalog only. The 15 existing tools and 2 POS candidates are preserved; detail remains closed.

## Fixed diagnostic

Read-only GET SELECTs: columns/types for doc/docdetail/docpayment, engines/sorting/primary keys, session readonly setting, current account's direct access-type/revoke flags, inherited-role count. No sample receipts/items/payments/people, free SQL, grant changes, CREATE/profile updates or source app startup. Every request uses readonly=1, resource/time/output caps and existing transport configuration; no fallback endpoint, no redirects, no credential/body/URL output. Per-check failures stay PARTIAL/unknown. Grants output is a small review summary, never raw grants/users/role names/other database names. Session readonly does not prove permanent account restrictions; effective privilege eligibility remains UNVERIFIED. No automatic permission or data binding change follows the result.

`pos_connection` contains: status/read_only/as_of, business_rows_requested=false, transport_https, session_readonly, columns[{table,name,type}], engines[{name,engine,sorting_key,primary_key}], grant_review{direct_select_observed,direct_non_read_grant_observed,inherited_role_count,effective_grants_verified:false}, reader_eligibility=UNVERIFIED, missing_coverage, limitations, and runtime_files{algorithm:'sha256',files:{fixed-source-path:digest}}. Runtime hashes read only application src/scripts/package files, never .env/secret/business files. Compare the resulting live hashes to the candidate manifest; the current old runtime has not been independently hashed in this Cloud session.

## Proposed staged configuration (not applied)

Project a7a9dbdd-f560-476f-98f4-119330c90e57; production environment8dd3216f-43c5-406c-8cac-c13519a42361; gateway service4cf6fa47-ca71-4c2b-a3de-fb78f3988e1f. Bind the **existing source identity solely for this fixed metadata diagnostic**. Its permanent privileges are unverified; do not enable the separate data adapter or client POS permission. These references resolve inside Railway without showing values in chat:

```json
{
  "BUSINESS_POS_METADATA_ENABLED":"true",
  "BUSINESS_POS_METADATA_CLIENT_NAME":"${{BUSINESS_OAUTH_CLIENT_NAME}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_HOST":"${{market-order-app.CLICKHOUSE_HOST}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_PORT":"${{market-order-app.CLICKHOUSE_PORT}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_SECURE":"${{market-order-app.CLICKHOUSE_SECURE}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_DATABASE":"${{market-order-app.CLICKHOUSE_DATABASE}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_USER":"${{market-order-app.CLICKHOUSE_USER}}",
  "BUSINESS_POS_METADATA_CLICKHOUSE_PASSWORD":"${{market-order-app.CLICKHOUSE_PASSWORD}}"
}
```

Do not rewrite opaque BUSINESS_MCP_CLIENTS_JSON/branch map/HRMS/OAuth bindings. Do not set BUSINESS_POS_CLICKHOUSE_URL or allow_pos_details in this metadata stage. Existing source protocol is preserved from SECURE; report it explicitly. Later data activation still requires verified profile, HTTPS and source/schema/classification facts. If any referenced variable is missing/empty/invalid, only the diagnostic is unavailable with a fixed binding error; the existing gateway/tools keep running. An unknown operator selector authorizes nobody. Inspect readiness before approval rather than guessing values or silently downgrading transport.

## Supported chat operation sequence

1. Obtain final approval for the reviewed commit + diagnostic references below; confirm active deployment and remote production source have not moved. Current repository integrationbase0c49016 has the15tool runtime identical to productionbasecec755f9; candidate builds from that base. SSD release gate remains pending because the helper/SSD is absent here; Cloud tests are explicitly separate. Resolve this documented gate with the owner before any release.
2. Publish only the reviewed candidate branch (no production branch rewrite). In Railway `connect_service_source` stage repo namo1997/market-order-app, that exact branch **and commitSha**, keeping root `/business-mcp` and existing Dockerfile/start/health/OAuth configuration. Stage only the diagnostic variables above via `set_variables(staged:true)`, using sealed flags where available. No values need to be retrieved.
3. `get_staged_changes` review: `accept_deploy` commits **all** staged environment changes, so stop if unrelated changes exist. Ensure only this gateway source/config delta is present. No source system deployments, grant/profile changes or business writes.
4. After explicit user release approval, `accept_deploy`, wait for terminal SUCCESS, verify deployment identity/pinned revision/health/OAuth unchanged. No blind restart or source app startup.
5. Call the current connector `business_describe_sources({})`, compare returned runtime_files to the reviewed manifest, inspect source schema/TLS/grant summary. Metadata-only status is not POS detail proof. If source privileges/metadata fail, return the exact missing check rather than treating grants as known or retrieving tokens elsewhere.
6. Keep details disabled until source facts and a proper reader binding are verified. Turn the temporary metadata flag off in a separately reviewed config change when no longer needed; no credentials are copied into packages/chats. Table-data connection and storefront/seller semantics remain separate acceptance gates.

Railway supports this workflow through the connected chat tools: connect_service_source(staged:true), set_variables(staged:true), get_staged_changes and accept_deploy. No staging, push, deploy or runtime change was performed for this candidate. Account privilege inspection is now possible without demanding a pre-verified reader identity circularly; it never authorizes table data by itself.
