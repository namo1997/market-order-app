export const evidenceDateCandidates = (value) => {
  const isoDate = String(value || '').slice(0, 10);
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, month, day] = match;
  return [
    isoDate,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day}/${month}/${year.slice(-2)}`,
    `${day}-${month}-${year.slice(-2)}`
  ];
};

const moneyValues = (text) => [...String(text || '').matchAll(/(?:^|[^\d])(-?\d[\d,]*\.\d{2})(?!\d)/g)]
  .map((match) => Number(match[1].replaceAll(',', '')))
  .filter(Number.isFinite);

export const evidenceTextHasAmount = (text, amount) => moneyValues(text)
  .some((value) => Math.abs(Math.abs(value) - Math.abs(Number(amount))) < 0.005);

export const evidenceTextHasDate = (text, date) => evidenceDateCandidates(date)
  .some((candidate) => String(text || '').includes(candidate));

export const findEvidenceRowIndex = (rows, { date, amount }) => {
  if (!date || !Number.isFinite(Number(amount))) return -1;
  return rows.findIndex((row) => {
    const cells = Array.isArray(row) ? row : [];
    return cells.some((cell) => evidenceTextHasDate(cell, date))
      && cells.some((cell) => evidenceTextHasAmount(cell, amount));
  });
};

export const focusEvidenceHtml = async (blob, focus) => {
  if (typeof DOMParser === 'undefined' || !focus?.date || !Number.isFinite(Number(focus?.amount))) {
    return { blob, found: false };
  }

  const parsed = new DOMParser().parseFromString(await blob.text(), 'text/html');
  const rows = Array.from(parsed.querySelectorAll('tbody tr'));
  const rowIndex = findEvidenceRowIndex(
    rows.map((row) => Array.from(row.cells).map((cell) => cell.textContent || '')),
    focus
  );
  if (rowIndex < 0) return { blob, found: false };

  parsed.getElementById('evidence-focus-row')?.removeAttribute('id');
  const focusedRow = rows[rowIndex];
  focusedRow.id = 'evidence-focus-row';
  focusedRow.setAttribute('aria-label', 'รายการที่เลือกจากระบบกระทบยอด');
  const style = parsed.createElement('style');
  style.textContent = `
    #evidence-focus-row td {
      background: #fff0a8 !important;
      border-top: 3px solid #b54a32 !important;
      border-bottom: 3px solid #b54a32 !important;
      color: #172033 !important;
      font-weight: 800 !important;
    }
    #evidence-focus-row td:first-child { border-left: 5px solid #b54a32 !important; }
    #evidence-focus-row td:last-child { border-right: 5px solid #b54a32 !important; }
  `;
  parsed.head.appendChild(style);
  const html = `<!doctype html>${parsed.documentElement.outerHTML}`;
  return {
    blob: new Blob([html], { type: 'text/html; charset=utf-8' }),
    found: true
  };
};
