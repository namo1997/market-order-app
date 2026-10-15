import camera from '../../assets/receiving/camera.svg';
import box from '../../assets/receiving/box.svg';
import signature from '../../assets/receiving/signature.svg';
import success from '../../assets/receiving/success.svg';
import empty from '../../assets/receiving/empty.svg';

const icons = { camera, box, signature, success, empty };
export function ReceivingIcon({ name, large = false }) {
  return <img className={large ? 'rc-illustration' : 'rc-icon'} src={icons[name]} alt="" aria-hidden="true" />;
}
