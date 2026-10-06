/* ตัวเลือกเหตุผลและ AI สำหรับจัดรูปเป็นอื่น ๆ ใช้ mutation/audit เดิม */
(() => {
  const presets = {
    account: 'เป็นรูปแจ้งเลขบัญชีหรือ QR สำหรับรับเงิน ยังไม่ใช่หลักฐานว่าโอนสำเร็จ',
    notice: 'เป็นข้อความแจ้งว่าจะโอนหรือขอให้โอน ยังไม่ใช่หลักฐานว่าโอนสำเร็จ',
    quotation: 'เป็นใบเสนอราคาหรือรายการราคา ยังไม่ใช่บิลค่าใช้จ่ายของรอบนี้',
    conversation: 'เป็นภาพแชทหรือข้อความประกอบ ไม่ใช่บิลหรือสลิป',
    general: 'เป็นรูปสินค้าหรือรูปทั่วไป ไม่ใช่เอกสารการเงิน'
  };
  const form = $('not-document-form');
  form.insertAdjacentHTML('afterbegin', `<label class="wide">รูปนี้เป็นอะไร<select class="input" id="not-document-kind" required><option value="">เลือกประเภทรูป</option><option value="account">แจ้งเลขบัญชี / QR รับเงิน</option><option value="notice">แจ้งว่าจะโอน / ขอให้โอน</option><option value="quotation">ใบเสนอราคา / รายการราคา</option><option value="conversation">ภาพแชท / ข้อความประกอบ</option><option value="general">รูปสินค้า / รูปทั่วไป</option><option value="custom">เหตุผลอื่น — ระบุเอง</option></select><small>ใช้เป็นเหตุผลของรายการนี้ เมื่อยืนยันจะย้ายไป “อื่น ๆ”</small></label>`);
  const actions = $('not-document-analyze').parentElement;
  actions.insertAdjacentHTML('beforebegin', `<label class="wide learntoggle"><input type="checkbox" id="not-document-use-ai"><span>ให้ AI ช่วยวิเคราะห์ก่อนตัดสินใจ<small>เลือกแล้วกด “ให้ AI วิเคราะห์” เพื่ออ่านรูปและเหตุผล · ไม่เลือก = บันทึกเองโดยไม่เรียก AI</small></span></label>`);
  const learn = $('not-document-learn');
  learn.checked = false;
  learn.nextElementSibling.innerHTML = 'ใช้การแก้ครั้งนี้เป็นตัวอย่างสอน AI<small>ไม่บังคับ · ต้องเลือกให้ AI วิเคราะห์และได้ผลว่าเห็นตรงกันก่อน</small>';
  const details = $('not-document-reason');
  details.rows = 2;
  details.placeholder = 'เพิ่มบริบทของรูปนี้ เช่น แจ้งบัญชีสำหรับคืนเงินสำรองจ่าย';
  details.insertAdjacentHTML('afterend', '<small id="not-document-reason-length" aria-live="polite"></small>');
  let generation = 0, busy = false;
  const originalReset = resetNotDocumentReview;
  const originalOpen = openNotDocument;
  const originalClose = closeNotDocument;
  const originalSubmit = form.onsubmit;

  notDocumentTeachingReason = function () {
    const kind = $('not-document-kind').value;
    const detail = details.value.trim();
    const reason = [presets[kind] || '', detail].filter(Boolean).join('\nรายละเอียดเพิ่มเติม: ');
    const answer = $('not-document-use-ai').checked ? $('not-document-clarification').value.trim() : '';
    return answer ? `${reason}\nคำตอบเพิ่มเติม: ${answer}` : reason;
  };
  updateNotDocumentSubmit = function () {
    const kind = $('not-document-kind').value;
    const useAI = $('not-document-use-ai').checked;
    const reason = notDocumentTeachingReason();
    const reviewed = notDocumentReview?.reason === reason;
    const valid = Boolean(kind && (presets[kind] || details.value.trim())) && reason.length <= 1000;
    const lengthHint = $('not-document-reason-length');
    lengthHint.textContent = reason.length > 1000
      ? `เหตุผลรวม ${reason.length} / 1,000 ตัวอักษร กรุณาย่อรายละเอียดหรือคำตอบเพิ่มเติมก่อนส่ง`
      : `เหตุผลรวม ${reason.length} / 1,000 ตัวอักษร รวมเหตุผลที่เลือกและคำตอบเพิ่มเติม`;
    lengthHint.className = reason.length > 1000 ? 'error' : '';
    const pendingAI = useAI && !reviewed;
    const pendingLearning = learn.checked && (!useAI || !reviewed || notDocumentReview?.decision !== 'accept');
    $('not-document-submit').disabled = busy || !valid || pendingAI || pendingLearning;
    $('not-document-submit').textContent = learn.checked ? 'ยืนยัน ย้ายไปอื่น ๆ และสอน AI' : 'ยืนยันและย้ายไปอื่น ๆ';
    $('not-document-analyze').disabled = busy || !valid;
    actions.hidden = !useAI;
    learn.disabled = !useAI;
    details.required = kind === 'custom';
    $('not-document-reason-label').textContent = kind === 'custom' ? 'ระบุว่ารูปนี้คืออะไร และเหตุผลที่จัดเป็นอื่น ๆ' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)';
  };
  resetNotDocumentReview = function (clearAnswer = true) {
    generation += 1;
    busy = false;
    originalReset(clearAnswer);
  };
  openNotDocument = function (row, label) {
    $('not-document-kind').value = '';
    $('not-document-use-ai').checked = false;
    learn.checked = false;
    details.value = '';
    originalOpen(row, label);
    $('not-document-sub').textContent = `รูป #${row.id} · ปัจจุบันจัดเป็น${label} · เลือกเหตุผลและวิธีตรวจได้`;
    updateNotDocumentSubmit();
    setTimeout(() => $('not-document-kind').focus(), 0);
  };
  closeNotDocument = function () {
    originalClose();
    learn.checked = false;
    $('not-document-use-ai').checked = false;
    updateNotDocumentSubmit();
  };
  analyzeNotDocumentReason = async function () {
    if (!notDocumentItem || !$('not-document-use-ai').checked || busy) return;
    updateNotDocumentSubmit();
    if ($('not-document-analyze').disabled) return;
    const token = ++generation, itemId = notDocumentItem.row.id;
    const reason = notDocumentTeachingReason();
    const current = () => token === generation && ! $('not-document-bg').hidden
      && notDocumentItem?.row.id === itemId && $('not-document-use-ai').checked
      && notDocumentTeachingReason() === reason;
    busy = true;
    updateNotDocumentSubmit();
    $('not-document-analyze').textContent = 'AI กำลังอ่านรูป…';
    try {
      const response = await api(`/api/admin/items/${itemId}/category-learning/review`, {
        method: 'POST', body: JSON.stringify({ reason, target_category: 'other' })
      });
      if (!current()) return;
      const review = response.data || {};
      if (!['accept', 'clarify'].includes(review.decision)) throw new Error('AI ยังไม่ส่งผลวิเคราะห์ที่ใช้งานได้ กรุณาลองใหม่หรือเลือกบันทึกเอง');
      notDocumentReview = { ...review, reason };
      const accepted = review.decision === 'accept';
      $('not-document-ai-result').hidden = false;
      $('not-document-ai-result').className = `wide notdocument-ai-result ${accepted ? 'agree' : 'clarify'}`;
      $('not-document-ai-status').textContent = accepted ? 'AI เห็นตรงกับเหตุผลของคุณ' : 'AI ยังมีข้อสงสัย — ตรวจคำแนะนำก่อนยืนยันเอง';
      $('not-document-ai-understanding').textContent = accepted
        ? (review.understanding || 'AI เห็นตรงกับเหตุผลนี้')
        : (review.question || 'อธิบายเพิ่มเพื่อให้ AI ตรวจอีกครั้ง หรือยืนยันเองโดยไม่สอน AI');
      $('not-document-clarify-wrap').hidden = accepted;
      $('not-document-analyze').textContent = 'ให้ AI วิเคราะห์อีกครั้ง';
    } catch (error) {
      if (!current()) return;
      notDocumentReview = null;
      $('not-document-ai-result').hidden = false;
      $('not-document-ai-status').textContent = 'AI วิเคราะห์ไม่สำเร็จ';
      $('not-document-ai-understanding').textContent = `${error.message} · ลองใหม่ หรือเอาเครื่องหมาย “ให้ AI ช่วยวิเคราะห์” ออกเพื่อบันทึกเอง`;
      $('not-document-analyze').textContent = 'ลองให้ AI วิเคราะห์อีกครั้ง';
    } finally {
      if (token === generation) { busy = false; updateNotDocumentSubmit(); }
    }
  };
  $('not-document-kind').onchange = () => resetNotDocumentReview();
  $('not-document-use-ai').onchange = () => {
    if (!$('not-document-use-ai').checked) learn.checked = false;
    resetNotDocumentReview();
  };
  details.oninput = () => resetNotDocumentReview();
  $('not-document-clarification').oninput = () => {
    generation += 1;
    busy = false;
    notDocumentReview = null;
    $('not-document-ai-status').textContent = 'มีข้อมูลเพิ่มเติม — ให้ AI ตรวจอีกครั้ง';
    $('not-document-analyze').textContent = 'ส่งคำตอบให้ AI วิเคราะห์อีกครั้ง';
    updateNotDocumentSubmit();
  };
  learn.onchange = updateNotDocumentSubmit;
  $('not-document-analyze').onclick = () => analyzeNotDocumentReason();
  $('not-document-close').onclick = () => closeNotDocument();
  $('not-document-cancel').onclick = () => closeNotDocument();
  form.onsubmit = async event => {
    event.preventDefault();
    updateNotDocumentSubmit();
    if ($('not-document-submit').disabled) return;
    return originalSubmit(event);
  };
  updateNotDocumentSubmit();
})();
