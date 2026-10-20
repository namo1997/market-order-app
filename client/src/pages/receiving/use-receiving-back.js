import { useEffect, useRef } from 'react';

// The shell owns the existing leave guard; pages provide only their destination.
export function useReceivingBack(onBackActionChange, back, blocked = false) {
  const latest = useRef(back);
  latest.current = back;
  useEffect(() => {
    if (!back) return;
    const registration = { back: () => latest.current?.(), blocked };
    onBackActionChange?.(registration);
    return () => onBackActionChange?.(null, registration);
  }, [onBackActionChange, Boolean(back), blocked]);
}
