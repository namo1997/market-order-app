// Inject Capacitor and Camera so adapter tests use only mocks.
export function createImageCapture({ isNative, camera, fetchImpl = fetch, makeFile = (parts, name, options) => new File(parts, name, options) }) {
  if (!isNative()) return null; // The page retains its input capture on the web.
  return async () => {
    try {
      const permission = await camera.requestPermissions({ permissions: ['camera'] });
      if (permission.camera !== 'granted') throw new Error('กรุณาอนุญาตใช้กล้องในตั้งค่า Android');
      const photo = await camera.getPhoto({ quality: 85, width: 2400, height: 2400,
        resultType: 'uri', source: 'CAMERA', saveToGallery: false, correctOrientation: true });
      if (!photo.webPath) throw new Error('อ่านรูปจากกล้องไม่สำเร็จ');
      const response = await fetchImpl(photo.webPath);
      if (!response.ok) throw new Error('อ่านรูปจากกล้องไม่สำเร็จ');
      const blob = await response.blob();
      return makeFile([blob], `bill.${photo.format || 'jpeg'}`, { type: blob.type || `image/${photo.format || 'jpeg'}` });
    } catch (error) {
      if (/cancel(?:led|ed)?|canceled|ยกเลิก/i.test(error?.message || '')) return null;
      if (/กรุณา|อ่านรูป/.test(error?.message || '')) throw error;
      throw new Error('เปิดกล้องไม่สำเร็จ กรุณาลองใหม่');
    }
  };
}
