// Guidance opens existing controls; choosing a problem never writes a decision.
function workflowProblemPlan(bucket, problem) {
  const bill = bucket === 'bill', pair = bucket === 'review';
  const search = bill ? 'selected-pick-slip' : 'selected-pick-bill';
  const plans = {
    wrong_pair: { text: 'เทียบรูป ผู้รับเงิน และเลขอ้างอิงก่อนเปลี่ยนคู่ หากไม่ใช่คู่กัน ให้บันทึกเหตุผลก่อนยืนยันการปฏิเสธ', controls: ['change', 'reject', 'combine-match'] },
    missing: { text: bill ? 'ค้นสลิปก่อนบันทึกเงินสดหรือส่งขอโอน ตรวจแชทและวันอื่นด้วยเพื่อป้องกันจ่ายซ้ำ' : 'ค้นบิลและตรวจแชท รวมถึงรูปที่อยู่ใน “อื่น ๆ” ก่อนสร้างใบแทน ตัวค้นปัจจุบันยังค้นเฉพาะกลุ่มเดียวกัน หากไม่พบให้ตรวจกลุ่มอื่นด้วย', controls: [search], receipt: !bill && !pair },
    amount: { text: 'เทียบยอดบนเอกสาร ยอดโอน และส่วนต่างจากรูป หากต่างเพราะคูปอง/ส่วนลด ต้องมีหลักฐานรองรับ ระบบยังไม่มีขั้นบันทึกส่วนต่างแยก อย่าแก้ยอดต้นฉบับเพียงเพื่อให้จับคู่ได้', controls: pair ? ['workflow-pair-amount'] : [bill ? 'workflow-bill-amount' : 'selected-edit-amount'] },
    non_purchase: { text: 'การโอนระหว่างบัญชี คืนเงินสำรอง เงินยืม และภาษี ต้องตรวจความหมายจากรูปและแชทก่อน ระบบยังไม่มีทางจัดการครบทุกประเภทในหน้านี้ อย่าสร้างใบแทนเพื่อทำให้คิวว่าง และอย่าย้ายหลักฐานการเงินไป “อื่น ๆ” เพียงเพราะหาบิลไม่พบ', controls: [] },
    incomplete: { text: 'ตรวจข้อความและภาพประกอบในแชทก่อน หากยังไม่พอให้กลับมาตรวจเมื่อมีหลักฐาน ปุ่มดูรายการถัดไปด้านล่างเปลี่ยนเฉพาะรายการที่เปิด ไม่บันทึกสถานะพักหรือเหตุผล', controls: ['skip-current'] }
  };
  return Object.hasOwn(plans, problem) ? plans[problem] : null;
}

(() => {
  const panel = document.getElementById('reviewpanel');
  if (!panel) return;
  const create = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  function sync() {
    if (!['review', 'bill', 'slip'].includes(S.bucket) || panel.querySelector('#review-next') || panel.querySelector('#workflow-guidance')) return;
    const pair = S.bucket === 'review';
    // Reimbursement reviews have their own evidence flow.
    if (pair && !panel.querySelector('#confirm')) return;
    const host = pair ? panel : panel.querySelector('.itemdecision');
    const primary = panel.querySelector(pair ? '#confirm' : S.bucket === 'bill' ? '#selected-pick-slip' : '#selected-pick-bill');
    if (!host || !primary || !panel.querySelector('#skip-current')) return;
    const bucket = S.bucket;
    const section = create('section', 'workflow-guidance'); section.id = 'workflow-guidance';
    const toolbar = create('div', 'workflow-toolbar');
    if (!pair) {
      primary.textContent = bucket === 'bill' ? 'หาสลิปของบิลนี้' : 'หาบิลของสลิปนี้'; toolbar.append(primary);
    }
    const problems = create('details', 'workflow-problems');
    const problemSummary = create('summary', '', 'แก้ปัญหารายการนี้'); problems.append(problemSummary);
    const choices = create('div', 'workflow-choices');
    const options = pair ? [['wrong_pair', 'จับคู่ผิด / ต้องเปลี่ยนคู่'], ['amount', 'ยอดหรือข้อมูลขัดแย้ง'], ['incomplete', 'หลักฐานยังไม่ครบ']] : [['missing', bucket === 'bill' ? 'หาสลิปไม่เจอ' : 'หาบิลไม่เจอ'], ['amount', 'ยอดไม่ตรง / มีคูปองหรือส่วนลด'], ['non_purchase', 'เงินนี้ไม่ใช่การซื้อสินค้า'], ['incomplete', 'หลักฐานยังไม่ครบ']];
    const result = create('div', 'workflow-result'); result.hidden = true;
    const message = create('p', 'workflow-message'); message.setAttribute('role', 'status');
    const routes = create('div', 'workflow-routes');
    const receiptChecks = create('div', 'workflow-receipt-checks'); receiptChecks.hidden = true;
    const checks = ['ตรวจแล้วว่าเงินนี้เป็นค่าสินค้าหรือบริการที่ต้องบันทึกค่าใช้จ่าย', 'ค้นหลักฐานในแชท วันอื่น และกลุ่มที่เกี่ยวข้องแล้ว ยังไม่มีบิลจริง'];
    const checkboxes = checks.map(text => {
      const label = create('label', ''); const input = document.createElement('input'); input.type = 'checkbox';
      label.append(input, document.createTextNode(text)); receiptChecks.append(label); return input;
    });
    const receipt = panel.querySelector('#selected-create-receipt');
    const more = create('details', 'workflow-more'); more.id = 'workflow-more';
    more.append(create('summary', '', 'ตัวเลือกอื่นและแก้ข้อมูล'));
    const moreBody = create('div', 'workflow-more-body'); more.append(moreBody);
    if (pair && panel.querySelector('#more')) {
      const edit = create('button', 'btn', 'เปิดรายละเอียดเพื่อเทียบและแก้ข้อมูลบิล'); edit.type = 'button'; edit.id = 'workflow-pair-amount';
      edit.onclick = () => { const details = panel.querySelector('#more'); details.open = true; details.querySelector('summary').focus(); details.scrollIntoView({block: 'nearest'}); };
      moreBody.append(edit);
    }
    // Keep the original nodes and handlers: audit, locking, previews and errors stay intact.
    const ids = pair ? ['change', 'combine-match', 'skip-current'] : ['selected-edit-amount', 'selected-request-transfer', 'confirm-cash-payment', 'classification-box', 'combine-unmatched', 'skip-current'];
    for (const id of ids) { const node = panel.querySelector('#' + id); if (node) moreBody.append(node); }
    if (bucket === 'bill') {
      const input = panel.querySelector('#selected-amount'), save = panel.querySelector('#selected-save-amount');
      if (input && save) {
        const amountForm = create('div', 'workflow-amount'); amountForm.id = 'workflow-bill-amount';
        const label = panel.querySelector('label[for="selected-amount"]'); if (label) { label.textContent = 'ยอดบนบิลต้นฉบับ'; amountForm.append(label); }
        amountForm.append(input, save); moreBody.prepend(amountForm);
      }
    }
    if (receipt) {
      receipt.textContent = 'ตรวจใบแทนก่อนบันทึกค่าใช้จ่าย'; receipt.disabled = true;
      receiptChecks.append(receipt);
      checkboxes.forEach(input => input.onchange = () => { receipt.disabled = !checkboxes.every(check => check.checked); });
    }
    const moved = [];
    for (const [key, text] of options) {
      const button = create('button', 'btn workflow-choice', text); button.type = 'button'; button.dataset.problem = key; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => {
        moved.splice(0).forEach(node => moreBody.append(node));
        const plan = workflowProblemPlan(bucket, key); message.textContent = plan.text; result.hidden = false;
        if (!pair) primary.hidden = key === 'non_purchase' || key === 'incomplete';
        choices.querySelectorAll('button').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
        receiptChecks.hidden = !plan.receipt; checkboxes.forEach(input => { input.checked = false; }); if (receipt) receipt.disabled = true;
        plan.controls.forEach(id => { const node = panel.querySelector('#' + id); if (node && node !== primary && node.id !== 'reject') { routes.append(node); moved.push(node); } });
        if (key === 'wrong_pair') message.textContent += ' ปุ่ม “ไม่ใช่คู่นี้” อยู่ข้างปุ่มยืนยันด้านล่าง';
      };
      choices.append(button);
    }
    result.append(message, routes, receiptChecks); problems.append(choices, result);
    toolbar.append(problems); section.append(toolbar, more);
    if (pair) {
      const feedback = panel.querySelector('#pair-feedback');
      if (feedback) { const notes = create('details', 'workflow-notes'); notes.append(create('summary', '', 'เพิ่มหมายเหตุ / เลือกสอน AI'), feedback); section.append(notes); }
      const bar = panel.querySelector('.bar'); bar.before(section);
    } else {
      const task = host.querySelector('.primarytask'); if (task) task.hidden = true;
      host.append(section);
    }
  }
  new MutationObserver(sync).observe(panel, { childList: true, subtree: true });
  sync();
})();
