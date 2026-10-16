import { useEffect, useState } from 'react';
import { motionQuery, readMotionPreference, saveMotionPreference } from './motion-preference';

const storage = () => {
  try { return window.localStorage; } catch { return undefined; }
};

export function useMotionPreference() {
  const [choice, setChoice] = useState(() => readMotionPreference(storage()));
  const [system, setSystem] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(motionQuery).matches ? 'reduce' : 'full');
  useEffect(() => {
    const media = window.matchMedia?.(motionQuery);
    const update = () => setSystem(media?.matches ? 'reduce' : 'full');
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  return [system === 'reduce' ? 'reduce' : choice || system, value => { setChoice(value); saveMotionPreference(storage(), value); }];
}

