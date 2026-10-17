export function readingProgress(elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return {
    seconds,
    label: seconds >= 30 ? 'เกือบเสร็จแล้ว' : seconds >= 10 ? 'กำลังอ่านรายการและราคา…' : 'AI กำลังอ่านบิล…',
    elapsed: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
