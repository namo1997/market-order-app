// Blind-count warnings come from the server as { product_id, quantity, unit }.
// Only the counter's own typed value is ever shown; never ordered/bill amounts.
export function flaggedCountLines(lines, warnings) {
  return warnings.map(warning => {
    const same = lines.filter(line => Number(line.product_id) === Number(warning.product_id));
    const matched = same.filter(line => (line.unit_text || 'หน่วย') === warning.unit);
    const found = matched.length ? matched : same;
    return { warning, line: found[0], lines: found };
  });
}

// A mark lasts only while the value is still the one that was flagged.
export function activeCountFlags(flags, counts) {
  return Object.fromEntries(Object.entries(flags).filter(([id, value]) => (counts[id] ?? '') === value).map(([id]) => [id, true]));
}
