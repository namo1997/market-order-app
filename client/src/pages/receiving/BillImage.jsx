import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

export function useBillImage(documentId, page) {
  const direct = page?.dataUrl || page?.url || '';
  const [state, setState] = useState({ url: '', error: false });
  const id = page?.id;
  const blob = page?.originalBlob;
  useEffect(() => {
    let active = true;
    let url;
    setState({ url: '', error: false });
    if (direct && !blob) return;
    if (!blob && !id) return;
    Promise.resolve(blob || api.image(documentId, id)).then(image => {
      if (!active) return;
      url = URL.createObjectURL(image);
      setState({ url, error: false });
    }).catch(() => { if (active) setState({ url: '', error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [documentId, id, direct, blob]);
  return { url: state.url || direct, error: state.error };
}

export function BillImage({ documentId, page, alt, ...props }) {
  const { url, error } = useBillImage(documentId, page);
  return url ? <img src={url} alt={alt} {...props} />
    : <p role="status">{error ? 'โหลดรูปไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่' : 'กำลังโหลดรูป…'}</p>;
}
