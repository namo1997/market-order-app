// Run window.runRedesignChecks() on the generated synthetic page at each
// 360/390/412 viewport and each theme. No production API or OCR provider is used.
export async function runRedesignChecks() {
  const results = [];
  const check = (condition, message) => { results.push({ ok: !!condition, message }); if (!condition) throw new Error(message); };
  const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const button = name => [...document.querySelectorAll('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name);
  await document.fonts.ready;
  document.querySelector('input[value="lines"]').click(); await tick();
  check([360, 390, 412].includes(innerWidth), 'target viewport 360/390/412');
  check(document.querySelectorAll('.rc-compact-item').length === 56, '56 rows, nothing accepted on load');
  check(document.documentElement.scrollWidth <= innerWidth, 'no page horizontal overflow');
  const largeText = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24;
  if (!largeText) {
    const headers = [...document.querySelector('.rc-compact-head').children];
    check(headers.map(node => node.textContent).join('|') === 'สินค้า|สั่ง|AI เสนอ|บาท', 'four ledger headers');
    for (const node of headers) check(node.scrollWidth <= node.clientWidth, `header fits: ${node.textContent}`);
  }
  for (const node of document.querySelectorAll('.rc-ordered,.rc-line-amount')) check(node.scrollWidth <= node.clientWidth, 'number fits without wrapping or clipping');
  for (const node of document.querySelectorAll('.rc-bulk-check')) {
    const rect = node.getBoundingClientRect(); check(rect.width >= 48 && rect.height >= 48, 'selection target >=48px');
  }
  button('เลือกทั้งหมดที่แสดง').click(); await tick();
  check(document.querySelectorAll('.rc-bulk-check input:checked').length === 56, 'select all displayed');
  check(window.fixtureCalls.length === 0, 'selection makes no API write');
  button('ล้างที่เลือก').click(); await tick();
  check(!document.querySelector('.rc-bulk-check input:checked'), 'clear selection');
  document.querySelector('#line-0-review').click(); await tick();
  const bar = document.querySelector('.rc-bulk-bar');
  for (const node of bar.querySelectorAll('button')) {
    const rect = node.getBoundingClientRect(); check(rect.width >= 48 && rect.height >= 48, 'batch action target >=48px');
  }
  window.scrollTo(0, document.documentElement.scrollHeight); await tick();
  check(document.querySelector('.rc-compact-item:last-child').getBoundingClientRect().bottom <= bar.getBoundingClientRect().top, 'last row clears measured batch bar');
  button('ยังไม่รับ').click(); await tick();
  check(document.querySelector('dialog[open]').textContent.includes('รับ 0 ในรอบนี้ ของที่เหลือยังรอรับ'), 'zero means receipt zero, retain remaining');
  button('ใช้ค่ากับ 1 รายการ').click(); await tick();
  check(document.querySelector('.rc-review-counts').textContent.includes('ตรวจแล้ว 1/56'), 'explicit decision advances once');
  button('เลิกทำ').click(); await tick();
  check(document.querySelector('.rc-review-counts').textContent.includes('ตรวจแล้ว 0/56'), 'undo restores proposal');
  return { width: innerWidth, theme: document.documentElement.dataset.theme, largeText, results };
}
