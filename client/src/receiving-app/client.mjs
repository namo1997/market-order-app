// APK-only injection: shared API modules keep their existing methods and payloads.
let current;
export function setApiClient(client) { current = client; }
export default Object.fromEntries(['get', 'post', 'put'].map(method => [method, (...args) => {
  if (!current) throw new Error('กรุณาเข้าสู่ระบบ');
  return current[method](...args);
}]));
