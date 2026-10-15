export function needsBillCheck(doc) {
  const codes = [...(doc.ocr?.warnings || []), ...(doc.warnings || [])]
    .map(warning => typeof warning === 'string' ? warning : warning.code);
  // A named/product row is still useful for human review even if its quantity
  // or product match needs correcting. Empty placeholder rows are not items.
  const hasItems = doc.lines.some(line => line.product_id || String(line.product_name || line.bill_text || '').trim());
  return doc.ocr?.status === 'done' && codes.includes('NOT_A_BILL') && !hasItems;
}
