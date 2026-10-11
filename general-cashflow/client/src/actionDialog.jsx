import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './actionDialog.css';

// In-page dialogs also work inside mobile previews and embedded webviews.
function ActionDialog({ message, initialValue, confirmOnly, finish }) {
  const dialog = useRef(null);
  const [value, setValue] = useState(initialValue);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="action-dialog" aria-labelledby="action-dialog-title" onCancel={event => { event.preventDefault(); finish(null); }}>
    <form onSubmit={event => { event.preventDefault(); finish(confirmOnly ? true : value); }}>
      <h2 id="action-dialog-title">{confirmOnly ? 'ยืนยันรายการ' : 'ระบุข้อมูล'}</h2>
      <p>{message}</p>
      {!confirmOnly && <textarea aria-label={message} value={value} onChange={event => setValue(event.target.value)} autoFocus rows={3}/>}
      <div><button type="button" onClick={() => finish(null)}>ยกเลิก</button><button type="submit" autoFocus={confirmOnly}>ยืนยัน</button></div>
    </form>
  </dialog>;
}
function ask(message, initialValue = '', confirmOnly = false) {
  const previousFocus = document.activeElement;
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      root.unmount(); host.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    root.render(<ActionDialog message={message} initialValue={initialValue} confirmOnly={confirmOnly} finish={finish}/>);
  });
}
export const requestText = (message, value = '') => ask(message, value);
export const requestConfirmation = async message => Boolean(await ask(message, '', true));
