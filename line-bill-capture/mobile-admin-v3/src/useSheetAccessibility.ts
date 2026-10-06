import { useEffect } from 'react';

export function useSheetAccessibility() {
  useEffect(() => {
    const origins = new Map<HTMLElement, HTMLElement | null>();
    const sheets = () => Array.from(document.querySelectorAll<HTMLElement>('.sheet-backdrop > section'));
    const sync = () => {
      for (const [sheet, origin] of origins) if (!sheet.isConnected) {
        origins.delete(sheet);
        if (origin?.isConnected) origin.focus();
      }
      for (const sheet of sheets()) if (!origins.has(sheet)) {
        origins.set(sheet, document.activeElement as HTMLElement | null);
        sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
        if (!sheet.hasAttribute('aria-labelledby')) sheet.setAttribute('aria-label', sheet.querySelector('h2')?.textContent || 'ตรวจเอกสาร');
        sheet.tabIndex = -1;
        (sheet.querySelector<HTMLElement>('button[aria-label^="ปิด"]:not(:disabled),button:not(:disabled),input:not(:disabled)') || sheet).focus();
      }
    };
    const close = (sheet: HTMLElement) => sheet.querySelector<HTMLButtonElement>('button[aria-label^="ปิด"]:not(:disabled)')?.click();
    const key = (event: KeyboardEvent) => {
      const sheet = sheets().at(-1); if (!sheet) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(sheet); }
      if (event.key === 'Tab') {
        const controls = Array.from(sheet.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')).filter((node) => node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); sheet.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const click = (event: MouseEvent) => { const sheet = sheets().at(-1); if (sheet && event.target === sheet.parentElement) close(sheet); };
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement, nav = document.querySelector('.bottom-nav');
      if (!sheets().length && target.closest('main') && nav && target.getBoundingClientRect().bottom > nav.getBoundingClientRect().top) target.scrollIntoView({ block: 'center' });
    };
    const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true }); sync();
    document.addEventListener('keydown', key, true); document.addEventListener('click', click); document.addEventListener('focusin', focus);
    return () => { observer.disconnect(); document.removeEventListener('keydown', key, true); document.removeEventListener('click', click); document.removeEventListener('focusin', focus); };
  }, []);
}
