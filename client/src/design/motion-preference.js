export const MOTION_STORAGE_KEY = 'solao.motion';
export const motionQuery = '(prefers-reduced-motion: reduce)';

export function readMotionPreference(storage) {
  try {
    const value = storage?.getItem(MOTION_STORAGE_KEY);
    return value === 'reduce' || value === 'full' ? value : null;
  } catch { return null; }
}

export function saveMotionPreference(storage, value) {
  try { storage?.setItem(MOTION_STORAGE_KEY, value); } catch { /* Private/WebView storage may be unavailable. Keep this session's choice. */ }
}

// Start the request immediately, but reveal its result only after readable feedback.
// Wait for failures too; preserve the original error for the caller's recovery flow.
export async function withSavingFeedback(work, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const [result] = await Promise.allSettled([Promise.resolve().then(work), wait(400)]);
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}
