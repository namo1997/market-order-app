# แผนที่ไฟล์ระบบรับสินค้า (`receiving-app`) — หาไฟล์ให้เจอใน 1 ขั้น

> อ่านไฟล์นี้ก่อนแก้งานรับสินค้า แล้วเปิดเฉพาะไฟล์ในแถวที่เกี่ยวข้อง ไม่ต้อง grep ทั้ง repo
> อัปเดต 2026-10-21 (release-port 4f8788d) · ภาพรวม/กติกา: [receiving-app.md](receiving-app.md) · ตรวจงาน: สกิล `solao-fastcheck` (`--affected` ระหว่างแก้, 2 รอบเต็มก่อนส่ง)
> ย่อ: `C` = `client/src/pages/receiving/`, `A` = `client/src/receiving-app/`, `AD` = `client/src/pages/admin/receiving/`, `M` = `server/src/models/`, `S` = `server/src/services/`, `CT` = `client/tests/`, `ST` = `server/tests/`

## 1. หน้าจอฝั่งพนักงาน (ตามลำดับ flow)

| ขั้น / หน้าจอ | Component (JSX) | Logic (.js ไม่มี React) | CSS | เทสต์ที่ดูแลหลัก |
|---|---|---|---|---|
| ตัวแอป APK / ล็อกอิน / shell | `A/ReceivingApp.jsx` (ราก), `A/PilotLogin.jsx`, `A/LeaveDialog.jsx` | `A/session.mjs`, `A/auth-mode.mjs`, `A/google-auth.mjs`, `A/leave-guard.mjs`, `A/native-shell.mjs`, `A/shell-theme.mjs`, `A/transport.mjs`, `A/api.mjs`, `A/runtime.mjs` | `A/style.css` | `CT/receiving-pilot`, `receiving-shell`, `receiving-native`, `receiving-app`, `A/*.test.mjs` |
| หน้าแรกแบบ "รับของใหม่ก่อน" (เจ้าของ 2026-10-23: พนักงานไม่เห็นคิวจากใบสั่ง สวิตช์ของผู้ดูแลในตัวเลือก) | `C/Receiving.jsx` (`newFirst`, `rc-home-mode`) | `client/src/api/receiving-followups.js` (`homeMode`/`setHomeMode`) → `server/src/routes/receiving-home.routes.js` (ค่า `receiving_home_mode` ใน `system_settings`) | `receiving.css` (`.rc-home-*`) | `receiving-home-mode` |
| หน้าแรก คิวร้าน/วันที่ | `C/Receiving.jsx` (router ของหน้ารับของ), `C/ShopWorkspace.jsx`, `C/FollowupBell.jsx`, `C/ThaiDateField.jsx`, `C/SupplierLeadSettings.jsx` (ตั้ง lead time ร้าน) | `receiving-queue.js`, `receiving-illustration-state.js`, `draft-reuse.js`, `receiving-branch.js` | `receiving.css` | `receiving-redesign`, `receiving-ui1-queue`, `receiving-queue-followup`, `receiving-ux-063`, `receiving-fix-c`, `fix-g`, `fix-k` |
| เลือกซัพ → สแกนบิลทันที (scan-first) | `C/CreateDocument.jsx`, `C/SupplierPicker.jsx` | `start-receiving.js` | `receiving.css` | `receiving-scan-first`, `receiving-fix-m` (ซัพไม่ผูก/ชื่อใหม่), `fix-n` |
| ถ่ายรูปบิล / หลายหน้า / คุณภาพภาพ | `C/ImagePages.jsx`, `C/BillImage.jsx`, `C/BillViewer.jsx` | `image-capture.js` (APK แทนด้วย `A/camera.mjs`, `A/native-capture.mjs`, `A/document-scanner.mjs`), `image-utils.js`, `image-quality.js`, `bill-viewer-history.js` | `image-quality.css` | `receiving-camera`, `receiving-image-quality`, `receiving-reading-ui`, `receiving-device-a07-ux` |
| กำลังอ่านบิล (OCR) | `C/BillReadingProgress.jsx`, `C/StatementNotice.jsx` | `reading-progress.js`, `receiving-ai.js` | `bill-reading.css` | `receiving-round-p-ocr`, `receiving-review-a-ports-ocr`, `receiving-statement-notice`, `receiving-device-r3` |
| **เอกสาร (หน้าหลักนับ/ตรวจ)** | `C/DocumentEditor.jsx` (410 บรรทัด — ประกอบทุกส่วนด้านล่าง), `C/BranchDocumentEditor.jsx` (ห่อ) | `review-a.js` (ขั้นตอน/blind/partial), `receiving-review.js` (คำเตือน/สรุป), `receiving-status.js` (ขาด/เกิน/ตรง), `counted-bill-match.js` | `review-a.css` | `receiving-review-a`, `receiving-review-v2`, `receiving-round-p-flow`, `receiving-device-a1-a11` |
| นับแบบ blind (แถวนับ) | `C/ReviewRows.jsx`, `C/ReceivingNumberField.jsx`, `C/LineNote.jsx` | `receiving-validation.js`, `decimal-entry.js`, `count-warning.js` | `review-a.css` | `receiving-device-fixes-q`, `receiving-count-warning-ux`, `receiving-r2`, `receiving-ux-060`, `ux-061`, `ux-062` |
| แก้บรรทัด / ตรวจที่ AI เสนอ | `C/LineEditor.jsx` | `line-review-state.js`, `review-card.js`, `receiving-ai.js` | `review-a.css` | `receiving-review-state`, `receiving-review-a-ports-editing`, `receiving-ux-a07-r2` |
| **ค้นหา/เลือกสินค้า** (ปุ่ม "เพิ่มสินค้าที่มาส่ง" / "เพิ่มของที่ไม่มีในบิล") | `C/ProductSearchSheet.jsx` (ชีตเต็มจอ) → `C/ProductPicker.jsx` (`variant="sheet"`; แบบ inline ใช้ใน LineEditor/ReviewRows), `C/SupplierProductSuggestions.jsx` (hook `useSupplierProducts` = ประวัติร้าน), `C/ReceivingProductScope.jsx` | — (เรียก `api/receiving-documents.js`) | `review-a.css` (`.ra-search-*`) | `receiving-search-ux`, `receiving-fix-m`, `fix-n`, `receiving-suppliers-item-code` |
| แบ่งแผนก / สาขา | `C/DepartmentAllocation.jsx` | `review-a.js` | `review-a.css` | `receiving-branch`, `receiving-branch-ocr`, `receiving-fix-h` |
| สรุป / รับแบบไม่มีบิล | `C/ReviewSummary.jsx`, `C/ManualReceiptSummary.jsx` | `review-ledger.js`, `receiving-utils.js` | `review-a.css` | `receiving-review-a-ports-summary`, `receiving-p8-partial`, `receiving-fix-j` |
| เซ็นรับ | `C/SignaturePad.jsx` | `use-review-layout.js` | `review-a.css` | `receiving-sign-summary-fix`, `receiving-signature-read`, `receiving-review-a-ports-signatures`, `receiving-review-layout` |
| ปัญหา (ขาด/เสีย/คืนของ) | `A/ReceivingIssues.jsx`, `A/ReceivingIssueCreate.jsx`, `A/ReceivingIssueDetail.jsx`, `A/ReturnEvidenceForm.jsx`, `A/IssueCloseConfirmation.jsx` | `A/issue-labels.mjs` | `A/receiving-issues.css` | `receiving-issues`, `receiving-issues-hierarchy`, `receiving-fix-d`, `fix-i` |
| สอนอ่านบิล (MVP, เมนูแอป เฉพาะบัญชี/ผู้ดูแล) | `A/BillTraining.jsx` (ใช้ `client/src/api/receiving-admin.js` alias endpoints) | — | `A/style.css` (`.bt-*`) | `A/bill-training.test.mjs` |
| แจ้งเตือน/ติดตาม | `A/PushFollowupDialog.jsx` | `A/push.mjs`, `A/alerts.mjs`, `A/followup-alerts.mjs` | — | `receiving-queue-followup`, `A/push.test.mjs` |
| ชิ้นส่วนกลาง | `C/ReceivingDialog.jsx`, `C/ReceivingIllustration.jsx`, `C/ReceivingInstallHint.jsx`, `C/ReceivingWebAppHead.jsx` | `use-receiving-back.js`, `use-receiving-dirty.js`, `receiving-web-app.js`, `receiving-utils.js` | `client/src/design/` (tokens) | `receiving-design`, `receiving-illustrations`, `receiving-ios-web`, `receiving-polish-p6p7`, `receiving-device-r2` |

API ฝั่ง client: `client/src/api/receiving-documents.js`, `receiving-issues.js`, `receiving-followups.js`, `receiving-admin.js` (เทสต์ `CT/receiving-api`)

## 2. หน้าจอฝั่งบัญชี (`/admin/receiving*`)

| หน้า | Component | Logic | เทสต์ |
|---|---|---|---|
| ใบรับของ (ledger + รายละเอียด) | `AD/AdminReceiving.jsx` (ทุกหน้าห่อด้วย `AD/ReceivingAdminShell.jsx`) → `ReceivingLedgerView.jsx`, `ReceivingDocumentView.jsx` (+ `LateProductLink.jsx` แผงรอผูกสินค้า), `LegacyBillPhotos.jsx` | `AD/receiving-ledger.js`, `AD/receiving-detail.js` | `CT/receiving-admin`, `receiving-fix-e`, `fix-f`, `receiving-real-bills-20261024` |
| ร้านค้า / รหัสเจ้าหนี้ / ชื่อย่อ | `AD/AdminReceivingSuppliers.jsx` → `ReceivingSuppliersView.jsx`, `ReceivingSupplierDetail.jsx` | `AD/receiving-suppliers.js`, `AD/receiving-supplier-links.js` | `receiving-suppliers-admin`, `receiving-suppliers-ux`, `receiving-supplier-crosslinks`, `receiving-suppliers-item-code` |
| เพิ่มสินค้าให้ร้าน (ทีละรายการ/CSV) | `AD/SupplierProductCreate.jsx` | `AD/supplier-product-import.js` | `receiving-suppliers-ux`, `ST/receiving-supplier-products` |
| ปัญหาทั้งหมด | `AD/AdminReceivingIssues.jsx` (ใช้ `A/ReceivingIssues.jsx`) | — | `receiving-issues-hierarchy` |
| แหล่งที่มาสต๊อก | `client/src/components/inventory/ReceivingStockSource.jsx` | `receiving-stock-source.mjs` | `receiving-stock-source` |

## 3. Server API → ไฟล์

| Endpoint (`server/src/app.js:107-112`) | Route → Controller | Model / Service หลัก | เทสต์ |
|---|---|---|---|
| `/api/receiving-documents` `GET / · POST / · GET /expected · GET /:id · PUT /:id · PATCH /:id` | `routes/receiving-documents.routes.js` → `controllers/receiving-documents.controller.js` | `M/receiving-documents.model.js` (ศูนย์กลาง), `-update.js`, `-helpers.js`, `receiving-queue-policy.js`, `receiving-draft-reuse.js`, `receiving-manual-order.js` | `ST/receiving-documents.{create,edit,validation,auth-scope}`, `receiving-blind`, `receiving-queue-followup`, `fix-k` |
| `POST /:id/images · GET /:id/images/:imageId` | 〃 | `M/receiving-documents.model.js` | `receiving-documents.images`, `.images-ocr` |
| `POST /:id/ocr` | 〃 | `M/receiving-documents-ocr-flow.js`, `M/receiving-branch-ocr.js`, `S/receiving-ocr.service.js`, `S/receiving-ocr-provider.js` (prompt/schema/โมเดล), `S/receiving-ocr-matcher.js` (จับคู่สินค้า), `S/receiving-ocr-checks.js`, `S/receiving-ocr-rate-limit.js` | `receiving-documents.ocr-provider`, `.matching`, `receiving-ocr-{dockind,findings,gaps,year,model-compatibility}`, `receiving-billing-statement`, `receiving-item-code` |
| `POST /:id/count` | 〃 | `M/receiving-documents-exceptions.js`, `M/receiving-documents-update.js` | `receiving-round-p-flow`, `receiving-p8-partial` |
| `POST /:id/signatures · GET /:id/signatures/:role` | 〃 | `M/receiving-documents-signatures.js` | `receiving-documents.signature-read` |
| `POST /:id/confirm · POST /:id/void` | 〃 | `M/receiving-documents-settlement.js`, `M/receiving-void-policy.js`, `M/receiving-void-issues.js` (ยกเลิกใบแล้วปิดเรื่องอัตโนมัติที่ยังไม่มีใครแตะ), `M/receiving-documents-alias.js` (เรียนรู้ชื่อย่อ) | `receiving-documents.confirm`, `.void`, `.alias`, `receiving-stock-integration`, `receiving-policy-11b`, `receiving-auto-receive-replace`, `receiving-void-issues` |
| `GET /products · /supplier-products · /suppliers` (ค้นหาสินค้า/ซัพ) | 〃 | `M/receiving-supplier-catalog.js`, `M/receiving-group-sql.js` | `receiving-fix-m`, `fix-n`, `receiving-collation` |
| `/api/receiving-admin` (ledger, suppliers/:key, aliases, products, profile, lead-times, `/:id/product-search` + `POST /:id/lines/:lineId/product` ผูกสินค้าให้บรรทัดที่รับไปก่อน) | `receiving-admin.routes.js` → `receiving-admin.controller.js`, `receiving-suppliers-admin.controller.js`, `receiving-late-link.controller.js` | `M/receiving-admin.model.js`, `-access.js`, `-history.js`, `-values.js`, `M/receiving-suppliers-admin.model.js`, `M/receiving-supplier-products.model.js`, `M/receiving-late-link.js` | `ST/receiving-admin`, `receiving-suppliers-admin`, `receiving-supplier-products`, `fix-e`, `fix-f`, `receiving-receive-unmatched` |
| `/api/receiving-export/ap/v1/documents` (token, บัญชีเจ้าหนี้ Cashflow) | `receiving-ap-export.routes.js` | `M/receiving-ap-export.model.js`, `-values.js` | `receiving-ap-export` |
| `/api/receiving-issues` | `receiving-issues.routes.js` → `receiving-issues.controller.js` | `M/receiving-issues-store.js`, `-policy.js`, `-schema.js`, `receiving-issue-display.js`, `receiving-issue-stock-return.js` | `receiving-issues`, `receiving-issues-endpoints`, `receiving-issue-stock-return` |
| `/api/receiving-followups`, `/api/receiving-push` | `receiving-followups.routes.js`, `receiving-push.routes.js` | `M/receiving-followups-store.js`, `S/receiving-push.js`, `S/receiving-fcm.js`, `S/receiving-notify*.js`, `cron/receiving-push-job.js` | `receiving-followup-endpoints`, `receiving-push`, `receiving-push-endpoints` |
| รับอัตโนมัติวันถัดไป | `cron/receiving-auto-job.js` | `M/receiving-branch-policy.js` | `receiving-parity-gaps`, `receiving-auto-receive-replace` |
| Schema (สร้างตาราง) | `server/scripts/migrate-receiving-{documents,issues,push}.js` | `M/receiving-{documents,issues,queue,push}-schema.js` | `receiving-documents.schema`, `receiving-collation`, `ddl-fk-safety` |
| เมนูรับของเดิม (ซ่อนแล้ว) | `middleware/legacy-receiving.js`, `config/legacy-receiving.js` | — | `legacy-receiving-rollout`, `CT/legacy-receiving-hidden` |

Test harness ฝั่ง server (เปลี่ยนแล้ว `--affected` จะรันทั้งชุด): `ST/helpers/receiving-fake-db.mjs`, `receiving-issues-db.mjs`, `receiving-queue-db.mjs`, `supplier-products-harness.mjs` · ฝั่ง client: `CT/receiving-harness.mjs`

## 4. ชื่อเทสต์ที่อ่านไม่ออก → เรื่อง

ไฟล์ชื่อตามรอบงาน (fix-c…n, device-r2…r4, ux-060…064) เดาจากชื่อไม่ได้ ใช้ตารางนี้

| ไฟล์ (ทั้ง CT และ ST) | เรื่อง |
|---|---|
| `fix-c` | คิวโหลดสาขาตัวเอง, เวลา UTC→กรุงเทพ |
| `fix-d` | คืนของ / undo คืนของ, บิลหายหลายใบ |
| `fix-e` | หน้า admin รายละเอียด `/admin/receiving/:id`, ยอดเงิน ledger |
| `fix-f` | ประวัติการตัดสินใจ (audit) ต่อแถว |
| `fix-g` | วันครบกำหนด/lead time, สรุปสาขาที่รับเกิน |
| `fix-h` | การ์ดบิลหาย, OCR แบบสาขา |
| `fix-i` | หลักฐานของปัญหา, ชื่อเจ้าของเรื่อง |
| `fix-j` | รับแบบไม่มีบิล (manual), ack ติดตาม |
| `fix-k` | ใช้ร่างเดิมซ้ำ (ซัพ/วัน/สาขาเดียวกัน) |
| `fix-m` | ซัพที่ไม่ผูก master, ค้นหา catalog |
| `fix-n` | การ์ดตัวเลือกซัพ/สินค้าแนะนำ, อัปบิลหลังนับ |
| `device-a07-ux`, `ux-a07-r2` | ปรับจากมือถือ A07: ธีม, ปุ่มเพิ่มหน้า, เลือกร้าน |
| `device-a1-a11` | blind ก่อน OCR, ของขาดเทียบใบสั่ง |
| `device-fixes-q` | แถวนับกะทัดรัด, คำใบ้ช่องว่าง vs 0 |
| `device-r2` / `r3` / `r4` | layout ไอคอน/ปุ่ม · คำเตือนบิล/แตะซ้ำ · ลายเซ็น |
| `ux-060`…`ux-064` | focus เลี่ยงแถบ/เครื่องหมายลบ · เหตุผล/ราคาว่าง · เลื่อนลายเซ็น · คิวว่าง · ack ราคา |
| `round-p-flow` / `round-p-ocr` | preflight จำนวนผิดปกติ, หมายเหตุ · คำเตือนเลขคณิต/VAT ในบิล |
| `p8-partial` | ส่งบางส่วน (สั่ง/เคยรับ/รอบนี้) |
| `polish-p6p7`, `sign-summary-fix` (P5) | ปุ่มกลับคิว/ชื่อร้านยาว · ลายเซ็นแบบแตะเปิด sheet |
| `review-a-ports-*` | พอร์ตเทสต์เดิมเข้าหน้า review-a แยกตาม editing / ocr / signatures / summary |
| `scan-first` | เลือกซัพแล้วสแกนบิลทันที + อ่านบิลทันที (ชื่อสินค้าเท่านั้น) (2026-10-21) |
| `device-072s` | เดินทดสอบทุกหน้าบนมือถือ 21 ต.ค.: ข้อความทศนิยม, เลือกทั้งช่องเมื่อแตะ, สัดส่วนลายเซ็น, ลำดับผู้ส่ง/ผู้รับ |
| `search-ux` | ชีตค้นหาสินค้าเต็มจอ, ซ่อนแถบล่าง, โฟกัสช่องนับหลังเลือก (2026-10-21) |

## 5. ที่อื่นที่เกี่ยวข้อง

- Android native: `client/android/app/src/main/java/th/co/solao/receiving/` (push, แจ้งเตือน) · เทสต์ `client/android/app/src/test/...` (`fastcheck --apk --android-tests`)
- entry เว็บ: `client/receiving.html`, `client/public/receiving.webmanifest`; route เว็บอยู่ใน `client/src/App.jsx`
- Pilot (เซิร์ฟเวอร์จำลอง ไม่มีฐานจริง/คีย์): `pilot/` — `seed*.mjs`, `codex-ocr.mjs` (OCR ด้วย Codex แทน API), `serve.mjs`
- สัญญา API: `docs/receiving-documents-api.md`, `receiving-issues-api.md`, `receiving-ap-export.md`, `receiving-accounting.md`
- ฝั่งบัญชีเจ้าหนี้: worktree `cashflow-integration-20261020` (`general-cashflow/`)

## ดูแลไฟล์นี้

เพิ่ม/ย้ายไฟล์รับสินค้าเมื่อไหร่ ให้แก้แถวที่เกี่ยวข้องในไฟล์นี้ใน commit เดียวกัน (เทสต์ `client/tests/receiving-codemap.test.mjs` ตรวจว่าทุก path ที่อ้างถึงมีอยู่จริง และทุกไฟล์ใน `pages/receiving`, `receiving-app`, `admin/receiving` ถูกกล่าวถึง)
