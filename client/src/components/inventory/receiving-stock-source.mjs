// Older order_receiving rows retain their order-item reference. The generated
// first line of each new movement note identifies the receipt; legacy cumulative
// notes use the last generated receipt entry.
export function receivingStockSource(item) {
  const type = String(item?.reference_type || '');
  let id;
  let action = 'รับสินค้าตามเอกสาร';
  if (['receiving_document', 'receiving_document_void', 'receiving_document_return'].includes(type)) {
    id = String(item.reference_id || '');
    if (type.endsWith('_void')) action = 'ยกเลิกเอกสารรับสินค้า';
    if (type.endsWith('_return')) action = 'คืนสินค้าตามเอกสาร';
  } else {
    const notes = String(item?.latest_receiving_notes ?? item?.notes ?? '');
    const matches = [...notes.matchAll(/^(รับสินค้าตามเอกสาร|ยกเลิกเอกสารรับสินค้า|คืนสินค้าตามเอกสาร) #(\d+)(?=\D|$)/gm)];
    const last = matches.at(-1);
    if (!last) return null;
    [, action, id] = last;
  }
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  return { id: Number(id), label: `${action} #${id}`, href: `/receiving?document_id=${id}` };
}
