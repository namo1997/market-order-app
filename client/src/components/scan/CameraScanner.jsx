import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanFlash, ScanResultCard, ScannedSummary } from './ScanResult';

// สแกนบาร์โค้ด CODE128 / QR ด้วยกล้องมือถือ แบบต่อเนื่อง (สแกนหลายดวงได้โดยไม่ต้องปิด)
// Chrome Android มี BarcodeDetector ในตัว → เร็วกว่า; iPhone/อื่น ๆ โหลด zxing เฉพาะตอนเปิดกล้อง
// กล้องเปิดได้เฉพาะหน้า https หรือ localhost
const NATIVE_FORMATS = ['code_128', 'qr_code'];
const VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 720 }
};

const createNativeDetector = async () => {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    if (Array.isArray(supported) && !NATIVE_FORMATS.every((format) => supported.includes(format))) return null;
    return new window.BarcodeDetector({ formats: NATIVE_FORMATS });
  } catch {
    return null;
  }
};

const cameraErrorText = (error) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'เปิดกล้องได้เฉพาะหน้า https';
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'ไม่ได้อนุญาตให้ใช้กล้อง';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'ไม่พบกล้อง';
    case 'NotReadableError':
      return 'กล้องถูกแอปอื่นใช้อยู่';
    default:
      return 'เปิดกล้องไม่ได้';
  }
};

// แสดงเมื่อ parent render เท่านั้น (เปิดกล้องตอน mount, ปิดกล้องตอน unmount)
export const CameraScanner = ({ onClose, onDetected, result, events = [] }) => {
  const videoRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [status, setStatus] = useState('starting');
  const [errorText, setErrorText] = useState('');
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    let stopped = false;
    let stream = null;
    let zxingControls = null;
    let timer = null;
    let flashTimer = null;
    const last = { code: '' };

    const emit = (rawValue) => {
      const code = String(rawValue || '').trim();
      if (!code || stopped) return;
      // ถือกล้องค้างที่ดวงเดิม: ไม่ส่งซ้ำ (จะได้ไม่ขึ้น "สแกนแล้ว" ทับผลเดิม) จนกว่าจะเห็นดวงอื่น
      if (code === last.code) return;
      last.code = code;
      setFlash(true);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setFlash(false), 350);
      onDetectedRef.current?.(code);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('no camera api'), { name: 'NotSupportedError' });
      }
      const native = await createNativeDetector();
      if (stopped) return;

      if (native) {
        stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
        if (stopped) return;
        video.srcObject = stream;
        await video.play();
        setStatus('scanning');
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const results = await native.detect(video);
              results.forEach((result) => emit(result.rawValue));
            }
          } catch {
            // เฟรมเสีย ข้ามไปเฟรมถัดไป
          }
          timer = setTimeout(tick, 120);
        };
        tick();
        return;
      }

      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library')
      ]);
      if (stopped) return;
      const hints = new Map([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]],
        [DecodeHintType.TRY_HARDER, true]
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      zxingControls = await reader.decodeFromConstraints(
        { video: VIDEO_CONSTRAINTS, audio: false },
        video,
        (result) => {
          if (result) emit(result.getText());
        }
      );
      if (stopped) {
        zxingControls.stop();
        return;
      }
      setStatus('scanning');
    };

    start().catch((error) => {
      if (stopped) return;
      setStatus('error');
      setErrorText(cameraErrorText(error));
    });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearTimeout(flashTimer);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black" role="dialog" aria-modal="true" aria-label="สแกนด้วยกล้อง">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
      />
      <ScanFlash result={result} />
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[42%] flex items-center justify-center">
        <div
          className={`h-[62%] w-[84%] max-w-md rounded-2xl border-4 ${flash ? 'border-emerald-400' : 'border-white/90'} shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-colors`}
        />
      </div>
      <div className="absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between px-4">
        <span className="rounded-full bg-black/60 px-4 py-2 text-lg font-bold text-white tabular-nums">
          {events.length} ดวง
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-2xl text-white"
          aria-label="ปิดกล้อง"
        >
          ✕
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-black/75 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        {status === 'error' && (
          <ScanResultCard result={{ id: 'camera-error', tone: 'error', title: errorText }} />
        )}
        {status === 'starting' && (
          <p className="py-3 text-center text-base text-white/80">กำลังเปิดกล้อง…</p>
        )}
        {status === 'scanning' && (
          result
            ? <div key={result.id} className="scan-result-pop"><ScanResultCard result={result} /></div>
            : <p className="py-3 text-center text-lg font-semibold text-white">ส่องบาร์โค้ดหรือ QR</p>
        )}
        <div className="mt-3 max-h-[22vh] overflow-y-auto">
          <ScannedSummary events={events} limit={4} dark />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl bg-white py-3.5 text-lg font-bold text-gray-900"
        >
          เสร็จ
        </button>
      </div>
    </div>,
    document.body
  );
};
