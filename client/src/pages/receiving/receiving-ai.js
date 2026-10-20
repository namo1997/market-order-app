const headerFields = ['supplier_name_text', 'doc_ref', 'doc_date', 'subtotal', 'discount', 'vat', 'total'];
const manual = line => line.match?.source === 'manual';

// Review provenance uses the existing API's manual match source, so accepting or
// editing survives a save/reopen and is protected by the server's OCR contract.
export const reviewedLine = line => ({ ...line, _aiReviewed: !!(line._aiProposal || line._aiReviewed), _aiProposal: undefined, _aiBaseline: undefined,
  match: { ...line.match, source: 'manual', confidence: 1 } });

export function markOcrProposals(doc) {
  if (doc.status !== 'draft' || doc.ocr?.status !== 'done') return doc;
  return { ...doc, lines: doc.lines.map(line => manual(line) || line._aiProposal ? line
    : { ...line, _aiProposal: { ...line }, _aiBaseline: null }) };
}

export function prepareOcrReview(previous, response, protectedHeaderKeys = new Set()) {
  const retainedIds = new Set();
  const lines = response.lines.map(line => {
    const prior = previous.lines.find(old => old.id === line.id
      || (line.order_item_id && old.order_item_id === line.order_item_id));
    if (!prior && manual(line)) return line;
    if (prior && manual(prior)) { retainedIds.add(prior.id); return { ...prior, id: line.id }; }
    return { ...line, _aiProposal: { ...line }, _aiBaseline: prior && Object.hasOwn(prior, '_aiBaseline') ? prior._aiBaseline : prior ?? null };
  });
  // Retain a human-created/edited row even if a provider omits it on reread.
  for (const line of previous.lines) {
    if (manual(line) && !retainedIds.has(line.id) && !lines.some(next => next.id === line.id)) lines.push(line);
  }
  const preserved = Object.fromEntries(headerFields.filter(key => protectedHeaderKeys.has(key) || (previous[key] != null && previous[key] !== ''))
    .map(key => [key, previous[key]]));
  return { ...response, ...preserved, lines };
}

export function resolveAiLine(line, decision) {
  if (decision === 'edit') return line;
  if (decision === 'skip') return line._aiBaseline ? reviewedLine({ ...line._aiBaseline, id: line.id }) : null;
  return reviewedLine(line);
}

export function retainAiReview(response, previous) {
  return { ...response, lines: response.lines.map(line => {
    const prior = previous.lines.find(old => old.id === line.id);
    return prior ? { ...line, _aiReviewed: prior._aiReviewed, ...(prior._aiProposal ? { _aiProposal: prior._aiProposal, _aiBaseline: prior._aiBaseline } : {}) } : line;
  }) };
}
