import { useEffect, useRef } from 'react';

// เครื่องยิงบาร์โค้ด (USB/Bluetooth) พิมพ์ตัวเลขรัว ๆ แล้วกด Enter: รับได้แม้ไม่ได้แตะช่องสแกน
// ข้ามเมื่อผู้ใช้กำลังพิมพ์ในช่องอื่น (input/textarea/select) หรือในช่องสแกนเอง (ฟอร์มจัดการแล้ว)
export const useWedgeScanner = ({ enabled = true, onCode, ownInputRef, length = 12, maxGapMs = 100 }) => {
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let buffer = '';
    let lastAt = 0;
    const onKeyDown = (event) => {
      const target = event.target;
      if (ownInputRef?.current && target === ownInputRef.current) return;
      const tag = String(target?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      const now = Date.now();
      if (now - lastAt > maxGapMs) buffer = '';
      lastAt = now;
      if (event.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length === length) {
          event.preventDefault();
          onCodeRef.current?.(code);
        }
        return;
      }
      if (/^\d$/.test(event.key)) buffer += event.key;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, ownInputRef, length, maxGapMs]);
};
