// เสียง + สั่น ตอนสแกน: ให้รู้ว่าสแกนแล้วโดยไม่ต้องมองจอ
// ok = ติ๊ด-ติ๊ด เสียงสูง, warn (ซ้ำ) = ตึ๊ด เสียงกลาง, error = ตื๊ด เสียงต่ำยาว
// iOS ต้องปลดล็อกเสียงจากการแตะของผู้ใช้ก่อน (unlockScanAudio ตอนกดปุ่มกล้อง/ช่องสแกน)
let audioContext = null;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) {
    try {
      audioContext = new AudioCtor();
    } catch {
      return null;
    }
  }
  return audioContext;
};

export const unlockScanAudio = () => {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    // เสียงเงียบสั้น ๆ ให้ iOS ยอมเล่นเสียงครั้งต่อไป
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore
  }
};

export const SCAN_TONES = {
  ok: [{ freq: 1320, ms: 70 }, { gap: 45 }, { freq: 1760, ms: 90 }],
  warn: [{ freq: 660, ms: 160 }],
  error: [{ freq: 220, ms: 380, type: 'square' }]
};

export const SCAN_VIBRATION = {
  ok: [40],
  warn: [80, 60, 80],
  error: [250, 80, 250]
};

const playTone = (tone) => {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  let at = ctx.currentTime + 0.01;
  for (const step of SCAN_TONES[tone] || SCAN_TONES.ok) {
    if (step.gap) {
      at += step.gap / 1000;
      continue;
    }
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type || 'sine';
      osc.frequency.value = step.freq;
      const end = at + step.ms / 1000;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      gain.gain.setValueAtTime(0.25, end - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(end + 0.02);
      at = end;
    } catch {
      return;
    }
  }
};

export const playScanFeedback = (tone) => {
  playTone(tone);
  try {
    navigator.vibrate?.(SCAN_VIBRATION[tone] || SCAN_VIBRATION.ok);
  } catch {
    // iOS ไม่มี vibrate
  }
};
