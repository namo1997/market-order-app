# Business MCP Gateway

- Gateway เป็น read-only เท่านั้น. ห้ามเพิ่ม POST/PUT/PATCH/DELETE ไปต้นทาง, SQL อิสระ, การแก้ข้อมูลธุรกิจ หรือเขียน finding กลับต้นทาง.
- HTTP route: `POST /mcp` (MCP, bearer), `GET /health` (สถานะบริการเท่านั้น), `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token` สำหรับ OAuth owner-only. stdio ผ่าน `src/stdio.mjs`.
- Env ที่กำหนด flow: `BUSINESS_MCP_CLIENTS_JSON`, `BUSINESS_BRANCH_MAP_JSON`, `HRMS_MCP_TOKENS_JSON`, `MARKET_ORDER_BASE_URL`, `HRMS_MCP_URL`, `CASHFLOW_BASE_URL`, `CASHFLOW_DOT_BEARER`, `LINE_BILL_BASE_URL`, `LINE_BILL_EXPORT_BEARER`, `BUSINESS_STDIO_CLIENT`, `BUSINESS_VERIFY_CLIENT`, `BUSINESS_PUBLIC_URL`, `BUSINESS_OAUTH_SIGNING_KEY`, `BUSINESS_OAUTH_PASSWORD_SHA256`, `BUSINESS_OAUTH_CLIENT_NAME`.
- ตรวจสิทธิ์สาขา/วันที่/บุคคลที่ Gateway ทุกครั้ง และให้ HRMS scoped token กรองที่ต้นทางซ้ำ. ห้าม join คนด้วยชื่อ.
- ผลทดสอบ/build/log/simulation ใหม่อยู่ SSD หลัง `ssd-workspace.mjs check` และรัน test ผ่าน `ssd-workspace.mjs run --project market-order-system --source <worktree>`. ห้าม deploy จาก SSD snapshot.
- เปลี่ยน route/env/flow ให้แก้ `README.md`, `AGENTS.md`, `CHANGELOG.md` ในงานเดียวกัน. ก่อน deploy ต้อง commit, ขออนุมัติผู้ใช้, ใช้ message ที่มี short commit, ตรวจ runtime hash, push branch/base ตาม root `AGENTS.md`.
