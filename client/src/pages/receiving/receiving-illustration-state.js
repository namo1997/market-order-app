export function needsBillCheck(doc) {
  const codes = [...(doc.ocr?.warnings || []), ...(doc.warnings || []).map(warning => warning.code)];
  return doc.ocr?.status === 'done' && (doc.lines.length === 0 || codes.includes('NOT_A_BILL'));
}
