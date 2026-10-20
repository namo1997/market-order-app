// Inject Capacitor and Camera so adapter tests use only mocks.
export function createImageCapture({ isNative, camera, notify = message => globalThis.alert(message), fetchImpl = fetch, makeFile = (parts, name, options) => new File(parts, name, options) }) {
  if (!isNative()) return null; // The page retains its input capture on the web.
  const cancelled = error => /cancel(?:led|ed)?|canceled|ยกเลิก/i.test(error?.message || '');
  const photoOptions = { quality: 85, width: 2400, height: 2400,
    resultType: 'uri', saveToGallery: false, correctOrientation: true };
  return async () => {
    let photo;
    let fallbackMessage = 'เปิดกล้องไม่สำเร็จ กรุณาเลือกรูปบิลจากเครื่อง';
    try {
      const permission = await camera.requestPermissions({ permissions: ['camera'] });
      if (permission.camera === 'granted') {
        photo = await camera.getPhoto({ ...photoOptions, source: 'CAMERA' });
      } else {
        fallbackMessage = 'ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาเลือกรูปบิลจากเครื่อง หรืออนุญาตกล้องในการตั้งค่า Android';
      }
    } catch (error) {
      if (cancelled(error)) return null;
      // Native/provider details can contain private paths or credentials.
    }
    if (!photo) {
      try {
        await notify(fallbackMessage);
        // The Android photo picker does not need camera permission. Do not
        // request camera/storage access again after a denial.
        photo = await camera.getPhoto({ ...photoOptions, source: 'PHOTOS' });
      } catch (error) {
        if (cancelled(error)) return null;
        throw new Error('เลือกรูปจากเครื่องไม่สำเร็จ กรุณาลองใหม่');
      }
    }
    try {
      if (!photo?.webPath) throw new Error('missing photo');
      const response = await fetchImpl(photo.webPath);
      if (!response.ok) throw new Error('อ่านรูปจากกล้องไม่สำเร็จ');
      const blob = await response.blob();
      return makeFile([blob], `bill.${photo.format || 'jpeg'}`, { type: blob.type || `image/${photo.format || 'jpeg'}` });
    } catch (error) {
      if (cancelled(error)) return null;
      throw new Error('อ่านรูปบิลไม่สำเร็จ กรุณาลองใหม่');
    }
  };
}
