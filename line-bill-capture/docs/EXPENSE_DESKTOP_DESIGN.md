# Expense document facts — desktop design brief

## Product and requested outcome
Thai operators review real bills/slips, identify purchase purpose, supplier and actual recipient, and save sourced facts without accidental matching or financial changes. This iteration completes the existing phase1 document profile workflow and Other classification options with tested buttons/input/error states. Desktop only is the design target: 1280×800, 1440×900 and 1920×1080. It does not activate downstream accounting exports or invent unresolved company/party integration decisions.

## Existing UI and chosen direction
The existing admin is a quiet light backoffice instrument with IBM Plex Sans Thai, tabular amounts, neutral borders and restrained action colors. Preserve these tokens, native dialog accessibility, original document facts, and explicit OCR proposal adoption. The old 620px tall form makes document comparison and saving require repeated scrolling; old history lists revisions without readable correction values.

Taste readout: clarity and evidence comparison matter more than decorative styling. Use a wide document-review workspace, stable header/footer and a distinct primary reviewed-save action. An alternative fullscreen dashboard adds unrelated chrome; a narrow wizard hides useful context. Both are less suitable than a two-pane workspace.

Reference routing: stay closest to current product style, using tasteful-ui production implementation mode. The Notion family supplies low-weight dividers, neutral reading surfaces and subordinate annotations only. Do not copy branding, editorial hero typography, marketing spacing, or dark cockpit decoration.

## Layout and visual rules
Native dialog roughly1180px wide within viewport, bounded height. Header shows document ID, review state and close control. Left pane holds the actual current document preview, metadata and explicit open-image action; right pane scrolls through four logical field groups, with related short fields in two columns. Long purpose/notes span their group. Footer keeps save controls available while scrolling. All controls remain visible/reachable by keyboard and no amount is editable here.

Use existing paper/ink/line tokens, primary button style, 14–16px readable Thai text, 8/12/16/24px spacing, understated borders/radii and a clear focus ring. No filler metrics/cards, invented evidence, mobile redesign, or animation. Long names, multiline chat and correction values wrap. Smaller widths may retain the existing safe fallback; no mobile deliverable is claimed.

## State and input behavior
Drafts are keyed by item, preserved on close/in-page navigation and protected against late loads/polls. Saved drafts persist across reload. Dirty indication updates while typing. Draft save permits missing purchase fields; reviewed-save requires transaction type, purchase supplier/purpose or explained exception, and supplier/payee relation when names differ. Validation explains the first missing field in Thai and focuses it. Full account input is rejected; masked input matches server validation. Reason is required with focus feedback.

No background confirmation, automatic proposal adoption, financial write, AI call or learning. Buttons show loading/disabled while request is pending, visible success only after actual API success, and retain edits on failed/conflicting save. Reload explicitly confirms replacing a dirty draft; cancellation retains it. Close/Escape restores focus to entry. Enter inside multiline inputs does not submit unexpectedly. Error paths allow retry. History shows actor/time/reason plus changed old/new values and their provenance. Historical evidence remains labelled as a snapshot.

Other classification preserves presets/custom reason, separately opt-in AI analysis and teaching, invalidates analysis when reason changes, and supports manual save with AI disabled. Test actual browser controls with mock AI only.

## Completion evidence
Maintain a requirement-by-requirement matrix and a reproducible CLI browser workflow using fictional documents/chat/images on verified SSD. Cover draft save/reload, every field/select/proposal/evidence action, reviewed validation, nonpurchase/unknown, masked account, revisions/history, conflict and reload accept/cancel, failed GET/PUT retry, delayed responses/double-click, scope navigation, keyboard, image handling and Other options. Browser actions must use real rendered UI, not direct API writes as substitutes. Independently test API invariants, all relevant regressions, build/smoke and source hashes. Screenshot desktop layouts and inspect actual image loading, scroll/footer positions and overflow.

Generated artifacts and logs go only to verified SSD. Canonical source is /Users/surachart/ระบบสั่งของตลาดสด/line-bill-capture; no unrelated dirty changes are staged or deployed.

## Local phase 4/5 — 2026-10-06

Keep the existing quiet accounting workspace and IBM Plex Sans Thai. Use the established Notion-inspired restrained dividers and secondary disclosures, without introducing a new visual system. The pair expense button follows the amounts immediately. A two-document pair opens one modal with an explicitly labelled document selector; switching retains independent drafts. Groups with more documents retain their existing selector and no document-count cap.

A reopened round has a single amber next-action message: remaining work → review it first; no remaining work → inspect summary and close again. The separate total badge is hidden only while this message represents reopened state. Closing counts/locks do not change. Three to five relevant AI reasons (when available) are primary; other reasons remain behind “ดูทั้งหมด”. Confirmed-pair negative reasons are historical references, and AI summaries are labelled as the reading-time summaries. Sender identity codes require explicit disclosure, while the displayed sender name stays visible.

Missing queue titles use supplier/purpose/AI summary. Evidence-pane metadata is labelled “ชื่อ / คำสรุปเอกสาร” when a summary is the fallback, so chat context is not presented as a verified printed supplier. Proposals include same-group/date/amount chat within 30 minutes (with message_id), group-name branch, stored AI summary and linked-slip OCR. Their source labels and evidence disclosures distinguish chat, group metadata, AI reading and the counterpart image. Long account-like digit sequences in expense response text/history are masked; account values contain at most four digits. Nothing saves or confirms automatically.

Government remittance covers กยศ., ภาษีหัก ณ ที่จ่าย, ประกันสังคม and employee deductions. Reviewed requires purpose, recipient and branch; irrelevant shop fields are collapsed without deleting previous values. Type/required-field rules match backend validation. Existing purchase/exception rules, local drafts, optimistic conflicts, audit and immutable history remain.

Acceptance evidence: `/Volumes/SSD Files/SOLAO/line-bill-capture/reports/expense-phase45-20261006-455c/`. Validate #2335/#2345 four proposals and real UI reviewed persistence, 1280×800/1440×900/1920×1080 overflow, reopened state, historical reasons, explicit sender disclosure, #2557 25-document selection, confirm/unconfirm and both Undo directions. Before/after views use SSD working copies of the existing frozen backup; no live Production access or deploy.

## 7 ตุลาคม 2569 — ฟอร์มอ่านตามลำดับงาน (Local)

ฝ่ายบัญชีตรวจข้อเท็จจริงเทียบเอกสารบน desktop 1280–1920px. ใช้ production_ui_implementation: คงภาพหลักฐานและยอดฝั่งซ้าย ผิวขาว เส้นบาง สีเดิม; ยืมเฉพาะลำดับตัวอักษรและการเปิดรายละเอียดทีละส่วนจาก Notion reference ของ tasteful-ui. ปัญหาหลักคือคำอธิบาย/หัวข้อซ้ำบดบังข้อมูลจริง ไม่เพิ่ม wizard หรือหน้าขั้นตอนใหม่.

- ฟอร์มหลักชุดเดียว: ประเภทรายการ → รายละเอียด → ร้าน (เมื่อเกี่ยวข้อง) → ผู้รับ → สาขา
- ธนาคาร บัญชี หน่วยงาน หมายเหตุ และร้านที่ไม่เกี่ยวข้องอยู่ข้อมูลเพิ่มเติม; เปิดเองเมื่อจำเป็น/มี error. ไม่ลบค่าเมื่อย่อ
- ข้อเสนอแต่ละค่ามีปุ่มใช้ค่านี้และที่มาแบบเปิดดู; หลังรับค่าตรงกันซ่อนข้อเสนอซ้ำ เก็บ provenance เดิม. ไม่เติมอัตโนมัติ
- สถานะบันทึกจุดเดียวใน footer; ไม่แสดงฉบับ 0 เป็นร่างที่บันทึกแล้ว. ป้ายจำเป็นสั้น อ่านได้ด้วย label/aria-describedby
- เหตุผลการตรวจยังต้องระบุเมื่อ reviewed; draft เว้นว่างได้ตามเดิม. คำอธิบายผลของการบันทึกอยู่รายละเอียด และ footer ข้อความสั้น
- ตรวจด้วยข้อมูล SSD #2335/#2345: ข้อเสนอครบ, รับค่าแล้วไม่ซ้ำ, ประเภท purchase/government เปลี่ยนช่องถูกต้อง, draft ไม่หายเมื่อสลับเอกสาร, required/error/409/history/evidence/audit ยังทำงาน

## Expense preparation extension — 2026-10-07 (Local)

Continue the existing restrained form and paired evidence view. Read purpose first, then transaction type, expense category, explicit month, beneficiary branch and actual recipient. Keep relevant supplier/relation fields and one optional-details disclosure. Category, transaction type and counterparty are independent facts. Mobile footer wraps; this remains an extension of the existing document form.

Add `expense_category`, `expense_period`, `followup_owner` and `classification_note` to the existing profile/revision JSON. Categories are `ingredients`, `packaging`, `personnel`, `utilities`, `premises`, `marketing`, `fees`, `asset_review`, `non_expense`, `other` and `pending`. Month accepts Gregorian `YYYY-MM`, 2000–2099 and months 01–12. Do not infer it from evidence dates. The four new fields use manual provenance only, with no new proposals. Preserve valid month text through response masking while retaining account protection. Asset review is a review flag; non-expense is a preparation fact. Neither creates accounting entries or changes the document's capture category.

Pending reveals a missing-information note and follow-up owner. An incomplete draft remains saveable; pending cannot be newly marked reviewed. Preserve the existing type-specific review checks, explicit audit reason, source adoption, masked accounts, optimistic conflicts and immutable history. Legacy reviewed profiles retain their stored status and are not automatically rewritten; the separate preparation completeness indicator identifies absent new facts. Completion language describes preparation only, never payment approval, ledger readiness or profit.

Acceptance must verify all category values, invalid month rejection, draft/save/reload and immutable history, pending validation and disclosure, legacy reviewed behavior, missing facts, source/evidence controls and keyboard/layout across existing desktop sizes. Inspect paired documents and preserved drafts. Current scoped Node24 tests pass backend 171 checks, integration 12 groups, assist 75, assist UI 13 and draft/month validation. CUA exercised pending rejection, draft save/reload with month/note/owner persistence, classified reviewed save and history. The 390×844 check led to header/workspace fixes and confirmed no horizontal overflow inside the dialog. Evidence: `/Volumes/SSD Files/SOLAO/line-bill-capture/runs/2026-10-07T07-04-48-905Z-5321ef7b/reports/preparation-report.md`, with `preparation-form.png` beside it. Full check/build/smoke was not run for this scoped Local increment; these results do not establish release readiness. Earlier evidence covers earlier phases only.

No new schema, routes, ledger, amounts, matching, closing or export writes in this increment. Local source changes require completed verification and integration before a separately authorized release. There is no Production write, deploy, push or commit in this task.

### Final hierarchy refinement requested by user
Three visible, restrained fieldset legends: รายการนี้คืออะไร, จัดหมวดและระบุรอบ, ร้านและผู้รับเงิน. Purpose has strongest label; thin rules and spacing separate groups. Amber appears only for pending/incomplete preparation. Manual-source labels are hidden to reduce repetition; source history remains. Proposals for populated fields collapse behind ข้อเสนอจากหลักฐาน, blank-field proposals stay open and explicit adoption still applies. Extra metadata remains secondary. Verified at desktop1280x900 and mobile390x844.

## Desktop colour and compact layout — 2026-10-07
Operator requested colour/icons, minimum scrolling, then prioritised desktop. Use blue document, green calendar, purple people line icons created with SVG DOM (no HTML injection). >=1100px details and classification share a row; people group spans below with three columns. Smaller fields remain legible and important labels preserved. Compact controls, spacing, footer and suggestion strip. Read-only browser measurement at1280x800: no horizontal overflow; form565px/content723px including secondary disclosure/history. Core facts visible without scrolling. Mobile is fallback, not deliverable priority.

Operator removed followup_owner from all editable sections. Existing saved values and history stay intact; do not render this input in pending or additional sections.

Branch is a select with คันคลอง / บ้านเจ๊ / ส่วนกลาง. Existing nonstandard values stay selectable as historical data until explicitly changed. Suggestions still require adoption, no automatic branch mapping.

Final branch choices in operator order: คันคลอง / บ้านเจ๊ / ผลิต / ส่วนกลาง.


## Nature versus category — 7 October2026

Keep the blue transaction group and green category/period group visually distinct. Use “ลักษณะรายการ” for transaction_type and “ใช้จ่ายเรื่องอะไร” for expense_category. Transfer, loan principal and withheld-money remittance omit the category input. If an old category exists, keep its value visible with a deliberate clear-in-draft action. Changing nature cannot erase evidence/history or silently restore a cleared category. Old non_expense is only a legacy value requiring review. Explain remittance as withheld funds/existing obligations, avoiding the implication that all government payments are nonexpenses. Reviewed-save rejects conflicts in both UI and backend; draft-save preserves them. Legacy supplier mismatch does not force an irrelevant hidden relationship for these natures.


## User-error prevention increment

Use one compact status strip distinguishing reviewed evidence from preparation readiness. Complete dirty/draft facts cannot display ready. Mixed category routes into pending allocation rather than invented whole-bill classification; no followup-owner control. Closed rounds show a readonly form and retain a raced unsaved draft. Saving never reopens the round. Dirty close and beforeunload make the in-memory limitation explicit. Month mismatch is a subordinate warning and never rewrites the user's month.

The separate summary shows preparation counts for confirmed evidence transactions, followed by the existing document counts. Users can open each canonical document; no summed amount or profit. Date filters describe evidence/transfer dates and not expense months. Contradictory classifications block readiness instead of picking a preferred field automatically.
