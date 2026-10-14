Build a mobile-first web app named "รับสินค้า โซลาว" (SOLAO Goods Receiving) for staff of a Thai restaurant group (2 branches: คันคลอง, สันกำแพง) who receive deliveries from suppliers at the back door. Everything the user sees must be in Thai. Tech: React + TypeScript + Tailwind, no backend of your own. It will later be wrapped with Capacitor into an Android APK, so: no browser-only APIs without a fallback, all network calls go through ONE api client module, and keep a clean folder structure (src/api, src/pages, src/components, src/lib, src/demo).

## Goal
At the moment goods arrive, staff finish in one flow: see what was ordered today → photograph the bill → AI reads the bill lines → match to ordered items → correct the actually-received quantity → receiver (and driver) sign on screen → submit. Must be faster than taking a photo and sending it to a LINE group.

## Users & devices
Shift leaders on cheap Android phones, one hand, often wet hands, bright kitchen light, weak Wi-Fi. Large touch targets (min 48px), font ≥16px, high contrast, one primary action per screen, bottom action bar. Colors: navy #1E3168 primary, gold #C8941C accent, cream #F7F5F0 background; green/amber/red only for status. Font: "Sarabun" (Google Fonts).

## Screens
1. ตั้งค่า (Settings): server URL, mode toggle "เดโม" / "เชื่อมระบบจริง", branch & department pickers (demo data), Gemini model name.
2. เข้าสู่ระบบ (Login): username + password → POST {server}/api/auth/login → stores JWT (in real mode). In demo mode, any login works.
3. วันนี้ (Today): date picker (default today, Asia/Bangkok). Cards per supplier: supplier name, number of items ordered, status chip (ยังไม่รับ / รับบางส่วน / รับครบ). Button "รับของ" on each card, and a secondary button "ใบรับของ (ไม่มีบิล)" for market purchases without a bill.
4. ถ่ายบิล (Capture): take one or more pages with the camera (input type=file accept=image/* capture=environment), preview thumbnails, retake/delete page. Resize on device to max 1600px long side, JPEG quality 0.8, ≤1.5 MB each. Button "อ่านบิล".
5. ตรวจรายการ (Review): after AI reading, a list of lines. Each line row: text as written on bill → matched product (dropdown limited to that supplier's ordered items, plus "ไม่ตรงกับรายการที่สั่ง"), quantity on bill, quantity actually received (big number stepper, editable), unit, unit price, amount. Header: supplier, bill number, bill date, subtotal, discount, VAT, total. Warning chips in Thai, colored, per line and at top:
   - SUM_MISMATCH "ยอดรวมรายการไม่ตรงกับยอดท้ายบิล" (difference > 1 baht)
   - PRICE_CHANGE "ราคาต่างจากครั้งก่อนเกิน 15%"
   - QTY_SHORT "รับน้อยกว่าที่สั่ง" / QTY_OVER "รับมากกว่าที่สั่ง"
   - UNMATCHED_LINE "หาสินค้าในรายการสั่งไม่เจอ"
   - DUPLICATE_BILL "บิลนี้อาจถูกส่งแล้ว"
   - LOW_CONFIDENCE "ระบบอ่านไม่ชัด ตรวจอีกครั้ง"
   Ordered items that no bill line matched are listed at the bottom as "สั่งแต่ไม่มีในบิล" with received qty 0 by default. User can add/delete lines manually.
6. เซ็นรับ (Sign): signature canvas (write it yourself with pointer events, no library) for ผู้รับของ (required) and คนส่งของ (optional) + driver name field. Clear/redo buttons.
7. ส่ง (Submit): summary, then submit. If offline, save to an outbox in IndexedDB (write a small wrapper yourself) and show "รอส่ง"; retry automatically when back online (navigator.onLine + 'online' event) and manually from the outbox screen. Every document has a client_uuid (crypto.randomUUID) so retries never create duplicates.
8. คิวรอส่ง (Outbox) and ประวัติ (History): list of documents with status chips: ร่าง / รอส่ง / ส่งแล้ว / ยกเลิก.
9. ใบรับของ (Manual receipt, no bill): same Review/Sign flow but lines are typed manually (product from ordered list or free text, qty, unit, price) plus a photo of the goods.

## AI bill reading
Use the Gemini API with image input and structured JSON output (responseSchema). Prompt it as an expert at reading Thai supplier bills, delivery notes, and handwritten market receipts. Output schema:
{ vendor_name, vendor_tax_id, doc_ref, doc_date (YYYY-MM-DD, convert Buddhist year 25xx to AD), lines: [{ text, quantity, unit, unit_price, amount, confidence (0-1) }], discount, subtotal, vat, total, overall_confidence (0-1), notes }
Numbers as numbers (no commas). Thai units like กก., ลัง, แพ็ค, ขวด, ถุง, ชิ้น kept as text. If a value is unreadable return null, never invent. Multiple pages = one document.
Then in the app: match lines to ordered items with a simple Thai-normalized fuzzy match (remove spaces, punctuation, unit words; compare Thai strings), compute the warnings listed above, and keep the user's manual edits if AI reading is re-run.
Put all AI code in src/lib/billReader.ts behind an interface `readBill(images): Promise<BillResult>` so it can later be moved to a server.

## Data contract (use these exact names — the real server will implement them)
Base path {server}/api/receiving-documents, JWT Bearer, responses { success, data } or { success:false, code, message }. Money as strings with 2 decimals, quantities as strings up to 3 decimals, dates YYYY-MM-DD.
- GET /expected?date= → [{ supplier_key, supplier_name, items:[{ order_item_id, product_id, product_name, unit_name, quantity_ordered, received_quantity|null, is_received }] }]
- POST / { client_uuid, delivery_date, kind:"bill"|"manual_receipt", supplier_name_text, order_item_ids } → document (draft)
- POST /:id/images { page_no, image_data_url } → { image_id }
- POST /:id/ocr → document with header, lines, warnings
- PUT /:id { header fields, lines, deleted_line_ids }
- POST /:id/signatures { role:"receiver"|"courier", image_data_url, name }
- POST /:id/confirm → confirmed document
- GET /?date=&status= → list
Document: { id, client_uuid, status:"draft"|"confirmed"|"void", kind, supplier_name_text, delivery_date, doc_ref, doc_date, subtotal, discount, vat, total, lines:[{ id, line_no, bill_text, product_id, product_name, order_item_id, unit_text, quantity_billed, quantity_received, unit_price, amount, match:{source:"alias"|"order"|"manual"|"none", confidence} }], warnings:[{code, message, line_no}] }
In real mode, OCR is done by the server (POST /:id/ocr). In demo mode, call Gemini directly from the app and run matching/warnings locally.

## Demo mode (default ON)
Built-in fake API in src/demo implementing the same contract in memory (persist to localStorage), with realistic Thai sample data: suppliers "หมูเจ๊เฉียง" (หมูสามชั้น 10 กก., สันคอ 5 กก.), "ผักลำพูน" (ผักกาดขาว 6 กก., ต้นหอม 2 กก., พริกขี้หนู 1 กก.), "แม็คโคร" (น้ำมันพืช 6 ขวด, น้ำตาลทราย 2 ถุง, ซีอิ๊วขาว 1 ลัง). Include one example where the AI result has a price change and one missing item, so all warning chips can be seen.

## Quality
- Works fully in demo mode with no server and with camera denied (falls back to file upload).
- Never store passwords; store only the JWT. No API keys hard-coded except the AI Studio-provided Gemini key mechanism.
- Accessibility: labels on inputs, visible focus, no text smaller than 14px.
- Show loading states for AI reading (it can take 10–30 s) with a cancel button.
- Add a README (Thai) explaining folders, demo mode, the data contract, and that the app will be wrapped with Capacitor for Android.
