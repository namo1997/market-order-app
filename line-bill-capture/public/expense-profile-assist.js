// ระยะ 2 ของ "ข้อมูลสำหรับค่าใช้จ่าย": ใช้ข้อเสนอทั้งหมด, รายชื่อให้เลือก, ที่มาจากเอกสารคู่/ประวัติที่ตรวจแล้ว
// โหลดก่อน expense-profile.js (ใช้ป้ายที่มา) แล้ว expense-profile.js เรียก attach() ส่งจุดเชื่อมให้ตอนสร้าง dialog
// ไฟล์นี้ไม่บันทึกข้อมูลเอง: ข้อเสนอลงร่างผ่าน store.set() เท่านั้น และผู้ใช้ต้องกดบันทึกเอง

const EXPENSE_ASSIST_SOURCE_LABELS = { paired_document: 'เอกสารคู่', remembered_pair: 'การตรวจก่อนหน้า' };
// ประเภทรายการมาก่อน เพราะเปลี่ยนว่าช่องไหนถูกย่อ/จำเป็น จึงต้องประเมินช่องที่เหลือหลังแสดงผลใหม่
const EXPENSE_ASSIST_FIRST = 'transaction_type';
const EXPENSE_ASSIST_LISTS = { supplier_name: 'suppliers', recipient_name: 'recipients', recipient_bank: 'banks' };
const EXPENSE_ASSIST_OPTIONS_TTL = 60000;

// ช่องที่ "ใช้ข้อเสนอทั้งหมด" เติมได้: มีข้อเสนอ ยังว่างทั้งในร่างและที่บันทึกไว้ และผู้ใช้มองเห็นอยู่ (ไม่ถูกระยะ 1 ย่อไว้)
function expenseAssistApplicable(record, isHidden = () => false) {
  const filled = key => String(record.fields?.[key]?.value ?? '').trim() !== '';
  return Object.keys(record.suggestions || {}).filter(key => {
    const suggestion = record.suggestions[key];
    return suggestion && typeof suggestion.value === 'string' && suggestion.value.trim() && !filled(key) && !isHidden(key);
  });
}
// ข้อความที่มาของข้อมูลที่ช่วยเสนอ ระบุเลขเอกสารคู่หรือจำนวนรายการที่ตรวจแล้ว
function expenseAssistOriginText(entry) {
  const ids = (entry?.evidence || []).map(ref => Number(ref.item_id)).filter(id => Number.isSafeInteger(id) && id > 0);
  if (entry?.source === 'paired_document') return ids.length ? `เอกสารคู่ ${ids.map(id => `#${id}`).join(', ')}` : 'เอกสารคู่';
  if (entry?.source === 'remembered_pair') return `การตรวจก่อนหน้า ${ids.length}${ids.length >= 8 ? '+' : ''} รายการ`;
  return null;
}

window.ExpenseProfileAssist = {
  sourceLabels: EXPENSE_ASSIST_SOURCE_LABELS,
  originText: expenseAssistOriginText,
  attach(hooks) {
    const { store, dialog } = hooks;
    const style = document.createElement('style');
    style.textContent = `.expense-profile-assist-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg,#f7f7f5)}
.expense-profile-assist-bar p{margin:0;flex:1 1 240px;font-size:12px;color:var(--ink-2)}
.expense-profile-assist-origin{display:block;font-size:11px;color:var(--ink-2)}.expense-profile-assist-origin a{margin-left:8px}`;
    document.head.append(style);
    let options = null, optionsAt = 0, loading = false, applied = null;
    const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
    const input = key => document.getElementById(`expense-profile-${key}`);
    const hidden = key => {
      const control = input(key);
      if (!control || control.disabled) return true;
      const section = control.closest('details.expense-profile-collapsed');
      return Boolean(section && !section.open);
    };
    const record = () => { const row = hooks.getRow(); return row ? store.record(row.id) : null; };

    function applyAll() {
      const row = hooks.getRow(), r = record();
      if (!row || !r || !r.loaded || r.busy || hooks.isStale() || !expenseAssistApplicable(r, hidden).length) return;
      let count = 0;
      const apply = key => { store.set(row.id, key, r.suggestions[key].value, r.suggestions[key]); count++; };
      // รอบแรกเฉพาะประเภทรายการ แล้วให้หน้าจอย่อ/ขยายช่องตามประเภทนั้นก่อนประเมินช่องที่เหลือ
      if (expenseAssistApplicable(r, hidden).includes(EXPENSE_ASSIST_FIRST)) { apply(EXPENSE_ASSIST_FIRST); hooks.rerender(); }
      expenseAssistApplicable(r, hidden).forEach(apply);
      applied = { id: row.id, count, edit: r.edit, focus: true };
      hooks.rerender(); // แถบปุ่มถูกสร้างใหม่ใน decorate() หลัง render จึงคืนโฟกัสที่นั่น
    }

    // จำนวนข้อเสนอที่ใช้ได้เปลี่ยนเมื่อผู้ใช้พิมพ์หรือเปิด/ปิดหมวดที่ถูกย่อ จึงคำนวณใหม่โดยไม่ render ทั้ง dialog
    // ปุ่มใช้ aria-disabled แทน disabled เมื่อไม่มีข้อเสนอเหลือ เพื่อให้โฟกัสไม่หลุดหลังกดใช้ทั้งหมด
    function refreshBar() {
      const bar = dialog.querySelector('.expense-profile-assist-bar'), row = hooks.getRow(), r = row && store.record(row.id);
      if (!bar || !r) return;
      const candidates = expenseAssistApplicable(r, hidden);
      const showApplied = applied && applied.id === row.id && applied.edit === r.edit;
      const button = bar.querySelector('button'), status = bar.querySelector('p');
      if (candidates.length) button.removeAttribute('aria-disabled'); else button.setAttribute('aria-disabled', 'true');
      const text = showApplied ? `เติม ${applied.count} ช่องแล้ว · ตรวจข้อมูลก่อนบันทึก`
        : candidates.length ? `เติมช่องว่างได้อีก ${candidates.length} ช่อง`
          : Object.values(r.suggestions || {}).some(proposal => typeof proposal?.value === 'string' && proposal.value.trim())
            ? 'ไม่มีข้อเสนอสำหรับช่องว่างที่เปิดอยู่ · กรอกเองหรือเปิดช่องเพิ่มเติมได้'
            : 'ยังไม่มีข้อเสนอให้ใช้ · กรอกข้อมูลเองได้';
      if (status.textContent !== text) status.textContent = text;
    }

    function decorate() {
      const row = hooks.getRow(), r = row && dialog.open ? store.record(row.id) : null;
      const form = dialog.querySelector('.expense-profile-form');
      if (!r || !r.loaded || !form || !form.querySelector('fieldset')) return;
      if (!form.querySelector('.expense-profile-assist-bar')) {
        const bar = node('div', '', 'expense-profile-assist-bar');
        const button = node('button', 'ใช้ข้อเสนอทั้งหมด', 'btn'); button.type = 'button'; button.id = 'expense-profile-apply-all';
        button.disabled = r.busy || hooks.isStale(); button.onclick = applyAll;
        const status = node('p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        bar.append(button, status); form.querySelector('fieldset').before(bar);
        refreshBar();
        if (applied && applied.id === row.id && applied.edit === r.edit && applied.focus) { applied.focus = false; button.focus({ preventScroll: true }); }
      }
      Object.entries(EXPENSE_ASSIST_LISTS).forEach(([key, listKey]) => {
        const control = input(key);
        if (!control || !options?.[listKey]?.length || control.getAttribute('list')) return;
        const list = document.createElement('datalist'); list.id = `expense-profile-list-${key}`;
        options[listKey].forEach(entry => { const option = document.createElement('option'); option.value = entry.value; list.append(option); });
        dialog.append(list); control.setAttribute('list', list.id); control.setAttribute('autocomplete', 'off');
      });
    }

    async function loadOptions() {
      if (loading || (options && Date.now() - optionsAt < EXPENSE_ASSIST_OPTIONS_TTL)) return;
      loading = true;
      try { const response = await store.request('/api/admin/expense-profile-options'); options = response.data; optionsAt = Date.now(); }
      catch { /* รายชื่อเป็นตัวช่วย ไม่ขัดการกรอกเมื่อโหลดไม่ได้ */ }
      finally { loading = false; }
      if (options) schedule();
    }

    let scheduled = false;
    const observer = new MutationObserver(() => schedule());
    function schedule() {
      if (scheduled) return; scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        // ปิด observer ระหว่างแต่งหน้าจอเอง ไม่ให้วนเรียกตัวเอง
        observer.disconnect();
        try { if (dialog.open) { decorate(); loadOptions(); } } finally { observer.observe(dialog, { childList: true, subtree: true }); }
      });
    }
    observer.observe(dialog, { childList: true, subtree: true });
    dialog.addEventListener('toggle', refreshBar, true); dialog.addEventListener('input', refreshBar); dialog.addEventListener('change', refreshBar);
  }
};
