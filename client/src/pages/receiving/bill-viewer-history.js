// One same-URL entry lets Android WebView Back dismiss the picture first.
// Preserve React Router's state; never put an image URL in navigation history.
let sequence = 0;

export function billViewerHistory(browser, onClose) {
  const history = browser.history;
  if (!history?.pushState) return { close: onClose, dispose() {}, isActive: () => true };
  const key = `bill-viewer-${++sequence}-${crypto.randomUUID()}`;
  let active = true;
  let closing = false;
  history.pushState({ ...history.state, solaoBillViewer: key }, '');
  const ownsEntry = () => history.state?.solaoBillViewer === key;
  const pop = () => {
    if (!active || ownsEntry()) return;
    active = false;
    onClose();
  };
  browser.addEventListener('popstate', pop);
  const dispose = () => {
    browser.removeEventListener('popstate', pop);
    if (active && ownsEntry()) { active = false; history.back(); }
    active = false;
  };
  return {
    close() {
      if (!active || closing) return;
      if (ownsEntry()) {
        // Wait for popstate before revealing the underlying controls. A rapid
        // reopen must not push another viewer while Back is still queued.
        closing = true;
        history.back();
      } else { active = false; onClose(); }
    },
    dispose,
    // False once Back already consumed the entry; callers must then close directly.
    isActive: () => active,
  };
}
