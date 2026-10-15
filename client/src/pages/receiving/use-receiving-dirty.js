import { useEffect, useRef } from 'react';

// Browser navigation and the embedding shell observe the same unsaved/busy state.
export function useReceivingDirty(isDirty, onDirtyChange) {
  const callback = useRef(onDirtyChange);
  useEffect(() => { callback.current = onDirtyChange; onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
}
