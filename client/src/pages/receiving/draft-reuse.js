// Queue lists already have the selected date/scope, but check them again before
// offering a draft from a shared branch or an administrator's previous filter.
export function reusableDraft(documents, { group, date, user }) {
  if (!group?.supplier_key) return null;
  return documents.filter(doc => doc.status === 'draft' && doc.delivery_date === date &&
    Number(doc.branch_id) === Number(user.branch_id) &&
    (doc.scope || 'department') === (user.receiving_scope || 'department') &&
    (doc.scope === 'branch' || Number(doc.department_id) === Number(user.department_id)) &&
    (group.supplier_key.startsWith('pg:') ? Number(doc.product_group_id) === Number(group.supplier_key.slice(3))
      : group.supplier_key.startsWith('sm:') ? !doc.product_group_id && Number(doc.supplier_master_id) === Number(group.supplier_key.slice(3))
        : !doc.product_group_id && !doc.supplier_master_id && doc.supplier_name_text === group.supplier_name))
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}
