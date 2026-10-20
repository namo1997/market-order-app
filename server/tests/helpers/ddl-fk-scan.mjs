// Static guard: MySQL rejects MODIFY/CHANGE of a column used by a foreign key
// (ER_FK_COLUMN_CANNOT_CHANGE_CHILD / _PARENT). Lazy schema ensure and pilot seeds must stay additive.
const split = list => list.split(',').map(c => c.replace(/[`\s]/g, '').toLowerCase()).filter(Boolean);

export function foreignKeyColumns(sources) {
  const columns = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+[`\w]+\s*\(([^)]+)\)/gi)) {
      for (const c of [...split(m[1]), ...split(m[2])]) columns.add(c);
    }
  }
  return columns;
}

// Returns every ALTER TABLE ... MODIFY/CHANGE [COLUMN] <col> found in the text.
export function modifiedColumns(text) {
  return [...text.matchAll(/ALTER\s+TABLE\s+[`\w]+\s+(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?[`]?(\w+)[`]?/gi)]
    .map(m => ({ statement: m[0].replace(/\s+/g, ' '), column: m[1].toLowerCase() }));
}

export function fkViolations(files) {
  const fk = foreignKeyColumns(Object.values(files));
  // The primary key every child references can never be altered either.
  fk.add('id');
  const found = [];
  for (const [file, text] of Object.entries(files)) {
    for (const item of modifiedColumns(text)) if (fk.has(item.column)) found.push({ file, ...item });
  }
  return found;
}
