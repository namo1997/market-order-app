export function MotionSwitch({ value, onChange }) {
  return <label className="sg-motion-switch"><input type="checkbox" role="switch" checked={value === 'reduce'}
    onChange={event => onChange(event.target.checked ? 'reduce' : 'full')} /><span>ลดการเคลื่อนไหว</span></label>;
}
