// เมื่อปิดหน้าต่างเดิมให้กลับปุ่มบนโต๊ะที่เปิดมัน โดยไม่เปลี่ยนงานหรือเรียกคำสั่งบันทึก
(() => {
  const api = window.LbcDesk;
  if (!api) return;
  let lastOpener = null;
  const opened = new Map();
  const scope = () => JSON.stringify([S.view,S.start,S.source,S.bucket,S.selected]);
  api.root.addEventListener('click',event=>{const button=event.target.closest('button');if(button)lastOpener=button;},true);
  const visible = node => node.tagName === 'DIALOG' ? node.open : !node.hidden;
  function sync() {
    for (const [node, origin] of opened) if (!node.isConnected || !visible(node)) {
      opened.delete(node);
      if (!api.root.hidden && origin.scope === scope() && origin.button?.isConnected) requestAnimationFrame(()=>origin.button.focus({preventScroll:true}));
    }
    if (api.root.hidden) return;
    document.querySelectorAll('.drawerbg,.chatlightbox,dialog[open]').forEach(node=>{
      if (visible(node) && !opened.has(node)) opened.set(node,{button:lastOpener,scope:scope()});
    });
  }
  new MutationObserver(sync).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open']});
  // รายการของ XS ใช้ jumpToProcess/openDay เดิม; เมื่อเสร็จแล้วให้โต๊ะเลือกคิวตาม S.selected
  document.addEventListener('click',event=>{
    if (!api.root.hidden && event.target.closest('[data-xs-open-day],[data-xs-item],[data-xs-transaction]')) {
      const selectedBefore=S.selected; let attempts=0;
      const wait=()=>{if(S.dayLoading&&attempts++<80)return setTimeout(wait,100);if(S.view==='day'&&!S.dayLoading){api.refresh();const current=api.current();if(Number(current?.row?.id)!==Number(S.selected)&&selectedBefore!==S.selected)window.dispatchEvent(new Event('lbc:desk-selection'));}};
      setTimeout(wait,150);
    }
  });
  sync();
})();
