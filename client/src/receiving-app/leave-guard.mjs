// One exit gate for logout, server changes and Android Back. A missing page
// callback is conservative: retain the confirmation until the page reports clean.
export function createLeaveGuard({ onPrompt, onLeave }) {
  let dirty = false;
  let pending = null;
  let leaving = false;
  async function perform(action) {
    if (leaving) return;
    leaving = true;
    try {
      await onLeave(action);
      pending = null;
      dirty = false;
      onPrompt(null);
    } finally { leaving = false; }
  }
  return {
    setDirty(value) { dirty = Boolean(value); },
    isDirty: () => dirty,
    async request(action) {
      if (leaving || pending) return;
      if (dirty) { pending = action; onPrompt(action); return; }
      await perform(action);
    },
    stay() { if (!leaving) { pending = null; onPrompt(null); } },
    async discard() { if (pending) await perform(pending); },
  };
}
