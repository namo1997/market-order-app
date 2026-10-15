export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export function assignPageNumbers(saved, pending) {
  let highest = Math.max(0, ...saved.map((page) => page.page_no), ...pending.map((page) => page.pageNo || 0));
  const pages = pending.map((page) => ({ ...page, pageNo: page.pageNo || ++highest }));
  if (highest > MAX_PAGES) throw new Error('ลำดับหน้าครบ 10 แล้ว กรุณาตรวจรูปที่ส่งไว้ก่อนเพิ่มหน้าใหม่');
  return pages;
}

export function validateSource(file) {
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('เลือกรูปขนาดไม่เกิน 25 MB ต่อหน้า');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('รองรับรูป JPG, PNG และ WebP กรุณาแปลงรูป HEIC ก่อน');
}
export function resizeDimensions(width, height, longest = 2400) {
  if (!(width > 0 && height > 0) || width * height > 60000000) throw new Error('รูปมีความละเอียดสูงเกินไป กรุณาถ่ายใหม่');
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function validateCompressed(blob) {
  if (!blob || blob.size > MAX_IMAGE_BYTES || !blob.size) throw new Error('ย่อรูปไม่สำเร็จ กรุณาถ่ายใหม่หรือเลือกรูปที่เล็กลง');
  return blob;
}
// แยก encoder เพื่อทดสอบขอบเขตขนาดจริงโดยไม่ใช้กล้องหรือ API
export async function compressWithEncoder(encode) {
  for (const scale of [1, 0.8, 0.6, 0.4]) {
    for (const quality of [0.86, 0.72, 0.55]) {
      const blob = await encode(scale, quality);
      if (blob?.size > 0 && blob.size <= MAX_IMAGE_BYTES) return validateCompressed(blob);
    }
  }
  return validateCompressed(null);
}
async function magicImage(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return (b[0] === 255 && b[1] === 216 && b[2] === 255)
    || (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10)
    || (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP');
}
export async function compressImage(file) {
  validateSource(file); // ก่อนอ่าน/decode
  if (!(await magicImage(file))) throw new Error('ไฟล์นี้ไม่ใช่รูปที่รองรับ กรุณาเลือกรูปใหม่');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const size = resizeDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    const blob = await compressWithEncoder((scale, quality) => {
      canvas.width = Math.round(size.width * scale);
      canvas.height = Math.round(size.height * scale);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    });
    return { blob, dataUrl: await blobToDataUrl(blob) };
  } finally { bitmap.close(); }
}
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ กรุณาเลือกรูปใหม่'));
  reader.readAsDataURL(blob);
});
