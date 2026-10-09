/* ชั้นจัดหน้าเท่านั้น: ช่อง/ปุ่ม/หลักฐานและ handler เป็น node เดิมทุกตัว */
(() => {
  const wide = matchMedia('(min-width:1100px)');
  const enabled = () => wide.matches && document.documentElement.classList.contains('theme-glass');
  const node = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const button = (text, cls = '') => { const b = node('button', text, cls); b.type = 'button'; return b; };
  let latest, current;
  const evidenceTabs = new Map();
  function restore() {
    if (!current) return;
    current.abort.abort();
    // คืนโครง/attribute ก่อนจัดหน้า ค่าที่ผู้ใช้กรอกเป็น property จึงไม่ถูกแทนร่าง
    const retained = new Set([...current.dialog.querySelectorAll('*'), current.dialog]);
    for (const detached of current.detached) { retained.add(detached); detached.querySelectorAll('*').forEach(el => retained.add(el)); }
    for (const [parent, children] of current.children) parent.replaceChildren(...children.filter(child => child.nodeType !== 1 || retained.has(child)));
    for (const [el, text] of current.texts) if (retained.has(el)) el.textContent = text;
    const restoreAttribute = (el, key) => { const old = current.attributes.get(el)?.find(([name]) => name === key); if (old) el.setAttribute(key, old[1]); else el.removeAttribute(key); };
    for (const el of current.attributes.keys()) {
      if (el.classList.contains('eg-native-select')) restoreAttribute(el, 'tabindex');
      if (el.classList.contains('eg-reload')) { restoreAttribute(el, 'aria-label'); restoreAttribute(el, 'data-tip'); }
      if (el.dataset.egField) el.removeAttribute('data-eg-field');
      el.classList.remove('expense-glass', 'eg-native-select', 'eg-record-info', 'eg-reload', 'eg-complete', 'eg-required');
      if (current.hidden.has(el)) restoreAttribute(el, 'hidden');
      if (el.classList.contains('expense-profile-alternative')) el.open = !el.closest('.expense-profile-field')?.querySelector('input,select,textarea')?.value;
      if (el.classList.contains('expense-profile-reason')) restoreAttribute(el, 'open');
      if (el.id === 'expense-profile-save-reviewed') restoreAttribute(el, 'title');
    }
    current = null;
  }
  function chips(select, signal) {
    const group = node('div', '', 'eg-chips'); group.setAttribute('role', 'group');
    group.setAttribute('aria-label', select.labels?.[0]?.textContent || select.id);
    const buttons = [...select.options].map(option => {
      const b = button(option.value ? option.textContent : 'ยังไม่ระบุ', 'eg-chip'); b.dataset.value = option.value;
      b.disabled = select.disabled || option.disabled;
      b.setAttribute('aria-pressed', String(option.value === select.value));
      b.tabIndex = option.value === select.value ? 0 : -1;
      b.onclick = () => {
        if (select.disabled || b.disabled) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById(select.id)?.closest('.expense-profile-field')?.querySelector(`.eg-chip[aria-pressed="true"]`)?.focus({ preventScroll: true });
      };
      return b;
    });
    group.append(...buttons); select.classList.add('eg-native-select'); select.tabIndex = -1;
    const focus = () => buttons.find(b => b.dataset.value === select.value && !b.disabled)?.focus({ preventScroll: true });
    select.addEventListener('focus', focus, { signal });
    group.addEventListener('keydown', ev => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault(); ev.stopPropagation();
      const available = buttons.filter(b => !b.disabled), index = available.indexOf(document.activeElement);
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? available.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(ev.key) ? -1 : 1) + available.length) % available.length;
      available[next]?.focus();
    }, { signal });
    select.after(group);
  }
  function sync() {
    const c = current, d = latest;
    if (!c || !d || c.form !== c.dialog.querySelector('.expense-profile-form')) return;
    const required = new Set([...d.required, ...d.preparationRequired]);
    // ดึงช่องที่กฎเดิมบังคับออกจากเพิ่มเติม ไม่บังคับผู้ใช้เปิดกล่องก่อนเห็นช่องที่ขาด
    for (const [key, box] of c.fields) {
      if (c.optional.has(key)) {
        if (required.has(key)) c.main.append(box);
        else c.homes.get(key)?.after(box);
      }
    }
    const visible = [...c.main.children].filter(el => el.classList.contains('expense-profile-field'));
    visible.forEach((box, i) => {
      const key = box.dataset.egField, filled = Boolean(d.record.fields[key]?.value?.trim());
      box.querySelector('.eg-number').textContent = filled ? '✓' : String(i + 1);
      box.classList.toggle('eg-complete', filled); box.classList.toggle('eg-required', required.has(key));
    });
    for (const [key, box] of c.fields) {
      const input = box.querySelector(`#expense-profile-${key}`), invalid = input?.getAttribute('aria-invalid') === 'true';
      const group = box.querySelector('.eg-chips');
      if (group) {
        group.classList.toggle('eg-invalid', invalid);
        group.title = invalid ? box.querySelector('.expense-profile-field-error')?.textContent || '' : '';
        for (const b of group.children) {
          b.setAttribute('aria-pressed', String(b.dataset.value === input.value));
          b.tabIndex = b.dataset.value === input.value ? 0 : -1;
          b.disabled = input.disabled || [...input.options].find(o => o.value === b.dataset.value)?.disabled;
        }
      }
      const alternative = box.querySelector('.expense-profile-alternative'); if (alternative) alternative.open = true;
    }
    const complete = [...required].filter(key => d.record.fields[key]?.value?.trim()).length;
    c.ring.textContent = d.readiness.status === 'not_applicable' ? 'ไม่ใช้กับรายการนี้' : `${complete}/${required.size}`;
    c.ring.style.setProperty('--eg-progress', `${required.size ? complete / required.size * 100 : 0}%`);
    c.ring.classList.toggle('eg-na', d.readiness.status === 'not_applicable');
    c.ring.title = c.dialog.querySelector('.expense-profile-preparation-status')?.textContent || '';
    c.ring.setAttribute('aria-label', d.readiness.status === 'not_applicable' ? c.ring.title : `ข้อมูลจำเป็นครบ ${complete} จาก ${required.size} ช่อง · ${c.ring.title}`);
    const save = c.dialog.querySelector('#expense-profile-save-reviewed');
    if (save) save.title = [...required].filter(key => !d.record.fields[key]?.value?.trim()).map(key => c.fields.get(key)?.querySelector('label')?.textContent || key).join(' · ') || c.ring.title;
    const period = c.dialog.querySelector('#expense-profile-expense_period');
    c.dialog.querySelectorAll('.eg-month[data-value]').forEach(b => b.setAttribute('aria-pressed', String(period?.value === b.dataset.value)));
  }
  function decorate() {
    const dialog = document.querySelector('.expense-profile-dialog'), form = dialog?.querySelector('.expense-profile-form');
    if (!enabled()) { restore(); return; }
    if (!dialog?.open || !form?.querySelector('fieldset')) return;
    if (current?.form === form) { sync(); return; }
    current?.abort.abort();
    const original = [dialog, ...dialog.querySelectorAll('*')];
    const c = current = { dialog, form, children: new Map(original.filter(el => [...el.childNodes].some(child => child.nodeType === 1)).map(el => [el, [...el.childNodes]])), attributes: new Map(original.map(el => [el, [...el.attributes].map(a => [a.name, a.value])])), abort: new AbortController(), fields: new Map(), homes: new Map(), optional: new Set(), hidden: new Set(), detached: new Set(), texts: new Map() };
    dialog.classList.add('expense-glass');
    const header = dialog.querySelector('.expense-profile-head'), evidence = dialog.querySelector('.expense-profile-document'), footer = dialog.querySelector('.expense-profile-footer');
    const icon = node('span', '', 'eg-title-icon'); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H6V3h1M14 3v5h4M9 12h6M9 16h5"/></svg>'; header.prepend(icon);
    const tools = dialog.querySelector('.expense-profile-record-tools'), reload = dialog.querySelector('.expense-profile-reload');
    c.ring = node('span', '', 'eg-ring'); c.ring.setAttribute('role', 'status'); header.insertBefore(c.ring, header.lastElementChild);
    if (reload) { reload.classList.add('eg-reload'); reload.setAttribute('aria-label', 'โหลดฉบับล่าสุด'); reload.setAttribute('data-tip', 'โหลดฉบับล่าสุด'); header.insertBefore(reload, header.lastElementChild); }
    const mainSection = node('fieldset', '', 'eg-main-section'); mainSection.append(node('legend', 'ข้อมูลรายการ', 'eg-main-legend')); c.main = node('div', '', 'eg-main'); mainSection.append(c.main);
    const firstSection = form.querySelector('fieldset'); firstSection.before(mainSection);
    for (const input of form.querySelectorAll('.expense-profile-field>[id^="expense-profile-"]')) {
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName)) continue;
      const key = input.id.slice('expense-profile-'.length), box = input.closest('.expense-profile-field');
      c.fields.set(key, box); box.dataset.egField = key;
      const home = document.createComment('ตำแหน่งช่องเดิม'); box.before(home); c.homes.set(key, home);
      const optional = Boolean(box.closest('.expense-profile-collapsed')); if (optional) c.optional.add(key); else c.main.append(box);
      const number = node('span', '', 'eg-number'); number.setAttribute('aria-hidden', 'true'); box.querySelector('.expense-profile-label-row').prepend(number);
      if (input.tagName === 'SELECT' && ['transaction_type', 'expense_category', 'branch', 'supplier_payee_relation'].includes(key)) chips(input, c.abort.signal);
      const alternative = box.querySelector('.expense-profile-alternative'); if (alternative) alternative.open = true;
      const help = box.querySelector('.expense-profile-field-help'); if (help) {
        const info = node('details', '', 'eg-help'); info.append(node('summary', 'ⓘ')); info.firstChild.setAttribute('aria-label', help.textContent); info.append(help); box.querySelector('.expense-profile-label-row').append(info);
      }
    }
    // ให้ประเภทรายการและหมวดอยู่คนละแถว; สาขา/เดือนและคู่บุคคลแบ่งแถวเดียวกัน
    for (const key of ['purpose','transaction_type','expense_category','branch','expense_period','supplier_name','supplier_payee_relation','recipient_name','classification_note']) {
      const box = c.fields.get(key); if (box && !c.optional.has(key)) c.main.append(box);
    }
    for (const section of [...form.children].filter(el => el.tagName === 'FIELDSET' && el !== mainSection)) {
      const exclusion = section.querySelector('.expense-profile-category-exclusion');
      if (exclusion) { const more = node('details', '', 'eg-category-note'); more.append(node('summary', 'รายการนี้ไม่ใช้หมวดค่าใช้จ่าย'), exclusion); mainSection.after(more); if (exclusion.querySelector('button')) more.open = true; }
      c.detached.add(section); section.remove();
    }
    const period = dialog.querySelector('#expense-profile-expense_period');
    // ใช้วันที่อ้างอิงเดิมสำหรับทางลัดเท่านั้น ไม่ default/set ร่างเอง
    const month = expenseProfileDefaultMonth(latest?.referenceDate);
    if (period && month) {
      const monthBar = node('div', '', 'eg-months');
      for (const delta of [-1, 0, 1]) {
        const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); const value = date.toISOString().slice(0, 7);
        if (value < period.min || value > period.max) continue;
        const b = button(date.toLocaleDateString('th-TH', { month: 'short', year: 'numeric', timeZone: 'UTC' }), 'eg-month'); b.dataset.value = value; b.disabled = period.disabled;
        b.onclick = () => { if (period.disabled) return; period.value = value; period.dispatchEvent(new Event('input', { bubbles: true })); period.dispatchEvent(new Event('change', { bubbles: true })); }; monthBar.append(b);
      }
      const calendar = button('เดือนอื่น…', 'eg-month'); calendar.disabled = period.disabled; calendar.onclick = () => { period.focus(); try { period.showPicker?.(); } catch { /* ช่องเดิมยังกรอกและโฟกัสได้ */ } }; monthBar.append(calendar); period.before(monthBar);
    }
    const preparation = dialog.querySelector('.expense-profile-preparation');
    if (preparation) evidence.append(preparation);
    const pageBadge = header.querySelector('.expense-profile-invoice-badge'); if (pageBadge && preparation) preparation.prepend(pageBadge);
    const originalDetails = node('details', '', 'eg-evidence-details'); originalDetails.append(node('summary', 'ข้อมูลหลักฐานเพิ่มเติม'));
    let primaryImage = evidence.querySelector('.expense-profile-image-link') || evidence.querySelector('.expense-profile-no-image');
    const generated = evidence.querySelector('.expense-profile-generated-document');
    if (!primaryImage && generated) { primaryImage = node('div', 'เอกสารที่สร้างไว้ · เปิดข้อมูลหลักฐานเพิ่มเติมเพื่อดูรายละเอียดและรายการต้นทาง', 'expense-profile-no-image'); evidence.prepend(primaryImage); }
    const slip = evidence.querySelector('.expense-profile-pair-slip');
    const originalChildren = [...evidence.children];
    const tabs = node('div', '', 'eg-evidence-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'เลือกหลักฐาน');
    const billTab = button(latest?.pair ? 'บิล' : 'เอกสาร', 'eg-tab'), slipTab = slip && button('สลิป', 'eg-tab');
    tabs.append(billTab); if (slipTab) tabs.append(slipTab);
    evidence.prepend(tabs);
    const show = value => {
      if (primaryImage) c.hidden.add(primaryImage); if (slip) c.hidden.add(slip);
      if (primaryImage) primaryImage.hidden = value === 'slip'; if (slip) slip.hidden = value !== 'slip';
      billTab.setAttribute('aria-pressed', String(value !== 'slip')); slipTab?.setAttribute('aria-pressed', String(value === 'slip'));
      evidenceTabs.set(latest?.row.id, value);
    };
    billTab.onclick = () => show('bill'); if (slipTab) slipTab.onclick = () => show('slip');
    const amount = evidence.querySelector('.expense-profile-document-amount');
    if (amount && slip) {
      const slipAmount = node('span', slip.querySelector('p')?.textContent || '', 'eg-slip-amount'); amount.append(slipAmount);
      const billValue = expenseProfileDocumentAmount(latest.row), slipValue = expenseProfileDocumentAmount(latest.pair.documents[1]);
      const match = node('span', billValue === null || slipValue === null ? 'ยังไม่ทราบยอด' : billValue === slipValue ? 'ยอดตรง' : 'ยอดต่าง', 'eg-amount-match');
      match.classList.toggle('eg-amount-different', billValue !== null && slipValue !== null && billValue !== slipValue); amount.append(match);
    }
    for (const el of originalChildren) {
      if ([primaryImage, slip, amount, preparation].includes(el)) continue;
      if (el.tagName === 'BUTTON') continue;
      if (el.tagName === 'H3' || el.tagName === 'SMALL') { c.hidden.add(el); el.hidden = true; continue; }
      originalDetails.append(el);
    }
    // หลักฐานยาว หลายหน้า และข้อมูลเอกสารที่สร้างไว้ อ่านในพื้นที่เลื่อนเดียวทางขวา
    form.append(originalDetails);
    if (generated) originalDetails.open = true;
    if (generated) for (const b of dialog.querySelectorAll('button')) if (b.textContent === 'ดูเอกสารที่สร้างไว้ทางซ้าย') {
      c.texts.set(b, b.textContent); b.textContent = 'ดูเอกสารที่สร้างไว้';
      b.addEventListener('click', () => { originalDetails.open = true; }, { capture: true, signal: c.abort.signal });
    }
    const seen = new Set(), messages = [...Object.values(latest?.record.fields || {}), ...Object.values(latest?.record.suggestions || {})]
      .flatMap(entry => expenseProfileEvidenceMessages(entry, latest.row, latest.record.history, S.chatState?.messages || []))
      .filter(message => !seen.has(message.line_message_id) && seen.add(message.line_message_id));
    if (messages.length) {
      const chatProof = node('blockquote', messages[0].text, 'eg-chat-proof'); chatProof.title = messages[0].text;
      chatProof.setAttribute('aria-label', 'ข้อความแชทที่อ้างอิงในข้อมูลหรือข้อเสนอ'); amount ? amount.after(chatProof) : evidence.append(chatProof);
    }
    const evidenceToggle = dialog.querySelector('.expense-profile-evidence-toggle'); if (evidenceToggle) evidence.append(evidenceToggle);
    show(slip && evidenceTabs.get(latest?.row.id) === 'slip' ? 'slip' : 'bill');
    const reason = footer.querySelector('.expense-profile-reason'); if (reason) reason.open = true;
    if (tools) { tools.classList.add('eg-record-info'); footer.querySelector('.expense-profile-action-box')?.prepend(tools); }
    const state = footer.querySelector('.expense-profile-state'); if (state) state.setAttribute('aria-live', 'polite');
    sync();
  }
  document.addEventListener('lbc:expense-state', ev => { latest = ev.detail; sync(); }, true);
  document.addEventListener('lbc:expense-render', decorate, true);
  wide.addEventListener('change', decorate);
  new MutationObserver(decorate).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
})();
