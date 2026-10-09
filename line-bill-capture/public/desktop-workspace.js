// โต๊ะทำงานบนจอคอม: จัดแชท/รายการ/รายละเอียดให้อยู่ในจอเดียว และเลื่อนรายการด้วยคีย์บอร์ด
// ไฟล์นี้จัดวางและนำทางอย่างเดียว ไม่เปลี่ยนข้อมูลหรือการตัดสินใจใด ๆ
(() => {
  const desktop = window.matchMedia('(min-width:1181px)');
  const SPLIT_MIN_WIDTH = 760;
  const layout = document.getElementById('worklayout');
  const list = document.getElementById('list');
  const panel = document.getElementById('reviewpanel');
  if (!layout || !list || !panel) return;
  const workpanel = layout.querySelector('.workpanel');
  const rowSelector = '.row[data-id],[data-item]';
  let lastKey = '';

  function fitHeight() {
    const on = desktop.matches && !layout.hidden;
    layout.classList.toggle('dw-on', on);
    if (!on) {
      layout.classList.remove('dw-split');
      layout.style.removeProperty('--dw-h');
      return;
    }
    const top = layout.getBoundingClientRect().top + window.scrollY;
    layout.style.setProperty('--dw-h', `${Math.max(480, window.innerHeight - top - 42)}px`);
    layout.classList.toggle('dw-split', workpanel.clientWidth >= SPLIT_MIN_WIDTH);
  }

  const rows = () => [...list.querySelectorAll(rowSelector)];
  const rowKey = row => row ? `${row.dataset.id ? 'm' : 'i'}${row.dataset.id || row.dataset.item}` : '';

  // เลื่อนในกล่องรายการเท่านั้น ไม่ดึงทั้งหน้าให้กระโดด
  function revealInList(row) {
    if (!row || !layout.classList.contains('dw-on')) return;
    const box = list.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < box.top + 4) list.scrollTop -= box.top + 4 - r.top;
    else if (r.bottom > box.bottom - 4) list.scrollTop += r.bottom - box.bottom + 4;
  }

  function onListChange() {
    const active = list.querySelector('.active');
    const key = rowKey(active);
    if (key && key !== lastKey) {
      if (layout.classList.contains('dw-on')) panel.scrollTop = 0;
      revealInList(active);
    }
    lastKey = key;
  }

  function addKeyHint() {
    const bar = workpanel.querySelector('.queuebar');
    if (!bar || bar.querySelector('.dw-keyhint')) return;
    const hint = document.createElement('span');
    hint.className = 'dw-keyhint';
    hint.innerHTML = '<kbd>↑</kbd> <kbd>↓</kbd> เลื่อนรายการ';
    hint.title = 'กดลูกศรขึ้น/ลง หรือ J/K เพื่อเปลี่ยนรายการ (เมื่อไม่ได้พิมพ์ในช่องกรอก)';
    bar.insertBefore(hint, bar.querySelector('#queuecount'));
  }

  const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const dialogOpen = () => [...document.querySelectorAll('.drawerbg,#chatlightbox,[role="dialog"]')]
    .some(el => !el.hidden && el.offsetParent !== null && !el.closest('#worklayout'));

  document.addEventListener('keydown', event => {
    if (!layout.classList.contains('dw-on') || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || dialogOpen()) return;
    const step = { ArrowDown: 1, j: 1, J: 1, ArrowUp: -1, k: -1, K: -1 }[event.key];
    if (!step) return;
    // ลูกศรในแชทหรือรายละเอียดยังใช้เลื่อนกล่องนั้นตามปกติ
    if (event.key.startsWith('Arrow') && event.target.closest?.('#chatlist,#reviewpanel')) return;
    const all = rows();
    if (!all.length) return;
    const current = all.findIndex(row => row.classList.contains('active'));
    const next = all[Math.min(all.length - 1, Math.max(0, current + step))];
    if (!next || next === all[current]) return;
    event.preventDefault();
    next.click();
    requestAnimationFrame(() => list.querySelector('.active')?.focus?.({ preventScroll: true }));
  });

  new MutationObserver(onListChange).observe(list, { childList: true });
  new MutationObserver(fitHeight).observe(layout, { attributes: true, attributeFilter: ['hidden'] });
  const resize = new ResizeObserver(fitHeight);
  resize.observe(workpanel);
  // หัวหน้าวัน (เช่นแถบเปิดรอบใหม่) สูงขึ้นเมื่อไรต้องคำนวณความสูงใหม่
  if (layout.previousElementSibling) resize.observe(layout.previousElementSibling);
  window.addEventListener('resize', fitHeight);
  desktop.addEventListener('change', fitHeight);
  addKeyHint();
  fitHeight();
})();
