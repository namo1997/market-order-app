import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAlerts } from './alerts.mjs';

function fixture({ platform = 'android', available = true, granted = true } = {}) {
  const calls = []; let id=66;
  const plugin = {
    ensureAlertPermission: async () => {calls.push(['permission']); return {granted};},
    notifyUrgent: async value => {calls.push(['post',value]);}, cancelAlert: async value => {calls.push(['cancel',value]);},
  };
  return {calls,plugin,alerts:createAlerts({capacitor:{getPlatform:()=>platform,isPluginAvailable:()=>available},plugin,nextId:()=>++id})};
}
test('alerts: permission precedes urgent local notification; payload and id can be cancelled', async () => {
  const {alerts,calls}=fixture();
  const id=await alerts.notifyUrgent({title:'เรื่องด่วนรับสินค้า',body:'เจ๊แววไก่สด ยังไม่ส่ง ขา B 10 กก.',data:{kind:'local-test'}});
  assert.equal(id,67); assert.equal(calls[0][0],'permission');
  assert.deepEqual(calls[1],['post',{id:67,title:'เรื่องด่วนรับสินค้า',body:'เจ๊แววไก่สด ยังไม่ส่ง ขา B 10 กก.',data:'{"kind":"local-test"}'}]);
  await alerts.cancelAlert(id); assert.deepEqual(calls.at(-1),['cancel',{id:67}]);
});
for (const config of [{platform:'web'},{available:false},{granted:false}]) {
  test(`alerts: unsupported/denied permission never posts (${JSON.stringify(config)})`, async () => {
    const {alerts,calls}=fixture(config);
    assert.equal(await alerts.ensureAlertPermission(),false);
    await assert.rejects(alerts.notifyUrgent({title:'ด่วน',body:'ตามของ'}),/สิทธิ์/);
    assert.ok(!calls.some(([type])=>type==='post'));
  });
}
test('alerts: simultaneous permission checks share one prompt and later recheck revoked permission', async () => {
  const {alerts,plugin,calls}=fixture(); let release;
  plugin.ensureAlertPermission=()=>{calls.push(['permission']);return new Promise(resolve=>{release=resolve;});};
  const first=alerts.ensureAlertPermission(), second=alerts.ensureAlertPermission();
  release({granted:true}); assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(calls.length,1);
  plugin.ensureAlertPermission=async()=>({granted:false}); assert.equal(await alerts.ensureAlertPermission(),false);
});
for (const options of [undefined,{}, {title:'',body:'x'},{title:'x',body:''},{title:'x'.repeat(161),body:'x'},{title:'x',body:'x'.repeat(1001)},{title:'x',body:'x',data:[]},{title:'x',body:'x',data:{large:'x'.repeat(4096)}}]) {
  test(`alerts: invalid/oversized input rejected before native call (${JSON.stringify(options)?.length||0})`, async () => {
    const {alerts,calls}=fixture(); await assert.rejects(alerts.notifyUrgent(options),/ข้อมูล/); assert.equal(calls.length,0);
  });
}
test('alerts: cyclic data and native errors never expose native internals', async () => {
  const {alerts,plugin,calls}=fixture(), data={};data.self=data;
  await assert.rejects(alerts.notifyUrgent({title:'x',body:'x',data}),/ข้อมูล/);assert.equal(calls.length,0);
  plugin.notifyUrgent=async()=>{throw Error('private stack token fixture');};
  await assert.rejects(alerts.notifyUrgent({title:'x',body:'x'}),error=>!error.message.includes('private'));
  plugin.cancelAlert=async()=>{throw Error('private stack');};
  await assert.rejects(alerts.cancelAlert(67),error=>!error.message.includes('private'));
});
for (const id of [0,-1,1.5,'67',2147483648]) {
  test(`alerts: cancel rejects invalid id ${id}`,async()=>{const {alerts,calls}=fixture();await assert.rejects(alerts.cancelAlert(id));assert.equal(calls.length,0);});
}
test('alerts: native hooks include polite Android13 permission, cold/warm acknowledgment and R8 keep rules', async () => {
  const read=path=>readFile(new URL(path,import.meta.url),'utf8');
  const plugin=await read('../../android/app/src/main/java/th/co/solao/receiving/ReceivingAlertsPlugin.java');
  assert.match(plugin,/requestPermissionForAlias\("notifications", call, "notificationPermissionResult"\)/);
  assert.match(plugin,/@PermissionCallback/);assert.match(plugin,/ไว้ภายหลัง/);assert.match(plugin,/getPermissionState\("notifications"\) == PermissionState.DENIED/);
  const main=await read('../../android/app/src/main/java/th/co/solao/receiving/MainActivity.java');
  assert.match(main,/registerPlugin\(ReceivingAlertsPlugin.class\)/);
  assert.equal((main.match(/UrgentNotifications.acknowledge\(this,/g)||[]).length,2);
  assert.match(await read('../../android/app/proguard-rules.pro'),/-keep,allowoptimization class th.co.solao.receiving.ReceivingAlertsPlugin/);
  const manifest=await read('../../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest,/android.permission.POST_NOTIFICATIONS/);assert.match(manifest,/android.permission.VIBRATE/);assert.match(manifest,/android:allowBackup="false"/);
});
