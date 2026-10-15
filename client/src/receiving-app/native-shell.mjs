import { Capacitor, registerPlugin } from '@capacitor/core';

const shell = registerPlugin('ReceivingShell');
export const isAndroidShell = () => Capacitor.getPlatform() === 'android';
export async function setSystemTheme(theme) {
  if (isAndroidShell()) await shell.setTheme({ dark: theme === 'dark' });
}
export async function setBackHandlerReady(ready) {
  if (isAndroidShell()) await shell.setBackHandlerReady({ ready });
}
export async function exitReceivingApp() {
  if (isAndroidShell()) await shell.exit();
}
