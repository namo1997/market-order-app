export const parseCsv = (text) => {
  const sanitized = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < sanitized.length; i += 1) {
    const char = sanitized[i];

    if (inQuotes) {
      if (char === '"') {
        if (sanitized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows
    .slice(1)
    .filter((cells) => cells.some((cell) => String(cell || '').trim() !== ''))
    .map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = (cells[index] ?? '').trim();
      });
      return record;
    });

  return { headers, rows: dataRows };
};

const escapeCsvValue = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const buildCsv = (headers, rows) => {
  const output = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(','))
  ];
  return output.join('\n');
};

export const downloadCsv = (filename, headers, rows) => {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
