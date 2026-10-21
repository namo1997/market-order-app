import { ProductPicker } from './ProductPicker';
import { ReceivingDialog } from './ReceivingDialog';
import { SupplierProductSuggestions, SUPPLIER_HISTORY_HELPER } from './SupplierProductSuggestions';

export const SEARCH_HELPER = 'ค้นหาสินค้าที่มาส่ง';

// Full-height add-product search: pinned input, vertical results, no sticky bar.
// Android Back closes it first (rc-back-dismiss + history entry in ReceivingDialog).
// `history` (useSupplierProducts) is optional: the bill-comparison step searches only.
export function ProductSearchSheet({ id, title, disabled, existingLines, history, onAdd, onExisting, onClose, branchId, departmentId }) {
  const hasHistory = Boolean(history?.available && history.items.length);
  return <ReceivingDialog title={title} className="ra-search-sheet rc-back-dismiss" backDismiss onClose={onClose}>
    <ProductPicker variant="sheet" id={id} line={{}} disabled={disabled} branchId={branchId} departmentId={departmentId} existingLines={existingLines}
      helper={hasHistory ? SUPPLIER_HISTORY_HELPER : SEARCH_HELPER} historyIds={history?.items.map(item => item.id)}
      onExisting={onExisting} onChange={onAdd}
      emptyState={history?.available ? <SupplierProductSuggestions source={history} doc={{ lines: existingLines }} disabled={disabled} onAdd={onAdd} /> : null} />
  </ReceivingDialog>;
}
