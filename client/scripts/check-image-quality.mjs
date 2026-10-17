// Real browser + offline image/UI checks. All generated files must stay on SSD.
// node scripts/check-image-quality.mjs <playwright entry> <sharp entry> <SSD output>
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const [pwEntry, sharpEntry, output] = process.argv.slice(2);
if (!output?.startsWith('/Volumes/SSD Files/SOLAO/')) throw Error('SSD output required');
const { chromium } = await import(pathToFileURL(pwEntry));
const { default: sharp } = await import(pathToFileURL(sharpEntry));
await fs.mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
await build({ absWorkingDir: root, bundle: true, format: 'iife', jsx: 'automatic', outdir: output, entryNames: 'fixture',
  loader: { '.svg': 'file', '.webp': 'dataurl', '.woff2': 'dataurl' },
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, {useState,useRef} from 'react'; import {createRoot} from 'react-dom/client';
    import {ImagePages} from './src/pages/receiving/ImagePages.jsx';
    import {compressImage, measureBitmap} from './src/pages/receiving/image-utils.js';
    import {analyzeImageData} from './src/pages/receiving/image-quality.js';
    import './src/pages/receiving/receiving.css';
    window.compressImage=compressImage; window.measureBitmap=measureBitmap; window.analyzeImageData=analyzeImageData;
    function App(){ const [pending,setPending]=useState([]), ref=useRef(); window.pending=pending;
      return <main className="solao" data-theme={new URLSearchParams(location.search).get('theme') || 'light'} style={{maxWidth:430,margin:'auto',padding:12}} lang="th">
        <ImagePages doc={{status:'draft',images:[]}} pending={pending} setPending={setPending} setProcessing={()=>{}} inputRef={ref}/>
        <button type="button" onClick={()=>ref.current.click()}>ถ่ายบิล</button>
      </main>; }
    createRoot(document.getElementById('root')).render(<App/>);` },
  plugins: [{ name: 'offline-api', setup(builder) {
    builder.onResolve({ filter: /^\/fonts\// }, args => ({ path: path.join(root, 'public', args.path) }));
    builder.onResolve({ filter: /\/api\/receiving-documents$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const receivingDocumentsAPI={image(){throw Error("No API in offline image fixture")}};' }));
  } }],
});
await fs.writeFile(path.join(output,'index.html'), '<meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
const darkFile = path.join(output,'dark.jpg');
await sharp({create:{width:1600,height:2400,channels:3,background:'#303030'}}).jpeg().toFile(darkFile);
const original = await sharp({create:{width:120,height:80,channels:3,background:'#ffffff'}}).composite([{input:{create:{width:40,height:30,channels:3,background:'#ff0000'}},left:0,top:0}]).jpeg().toBuffer();
const browser = await chromium.launch({ headless: true });
const results = { layouts: [], exif: [], timing: null };
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error=>errors.push(error.message));
  // file:// avoids any server, credentials or API dependency.
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  for (const fallback of [false,true]) for (const orientation of [1,2,3,4,5,6,7,8]) {
    const data = await sharp(original).withMetadata({ orientation }).jpeg().toBuffer();
    const result = await page.evaluate(async ({bytes,fallback}) => {
      const bitmap=window.createImageBitmap;
      if(fallback) window.createImageBitmap=undefined;
      try {
        const result=await window.compressImage(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));
        const decoded=await bitmap(result.blob); const c=document.createElement('canvas'); c.width=decoded.width;c.height=decoded.height;
        const context=c.getContext('2d');context.drawImage(decoded,0,0);decoded.close();
        const corner=(x,y)=>Array.from(context.getImageData(x,y,1,1).data).slice(0,3);
        return {width:c.width,height:c.height,corners:[corner(5,5),corner(c.width-6,5),corner(5,c.height-6),corner(c.width-6,c.height-6)]};
      } finally {window.createImageBitmap=bitmap;}
    },{bytes:[...data],fallback});
    assert.equal(result.width, orientation>=5?80:120); assert.equal(result.height,orientation>=5?120:80);
    const redCorner=[0,1,3,2,0,1,3,2][orientation-1];
    result.corners.forEach(([r,g,b],i)=> assert.ok(i===redCorner ? r>180&&g<70&&b<70 : r>180&&g>180&&b>180,`orientation ${orientation} corner ${i} fallback ${fallback}`));
    results.exif.push({orientation,fallback,...result});
  }
  for (const width of [360,390,412]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:800});
    await page.goto(pathToFileURL(path.join(output,'index.html')).href+'?theme='+theme);
    await page.getByLabel('รูปบิล',{exact:true}).setInputFiles(darkFile);
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByText('แสงน้อย — เปิดไฟหรือย้ายไปที่สว่าง',{exact:true}).last().isVisible());
    const retake=page.getByRole('button',{name:'ถ่ายใหม่',exact:true});
    const use=page.getByRole('button',{name:'ใช้ภาพนี้',exact:true});
    for (const button of [retake,use]) { const box=await button.boundingBox(); assert.ok(box.height>=48&&box.width>=48); }
    const geometry=await page.evaluate(()=>({ viewport:innerWidth,scroll:document.documentElement.scrollWidth,dialog:document.querySelector('dialog').getBoundingClientRect().toJSON() }));
    assert.ok(geometry.scroll<=width); assert.ok(geometry.dialog.width<=width);
    await page.screenshot({path:path.join(output,`warning-${width}-${theme}.png`)});
    // User-gesture retake opens a real file chooser while the warning sheet is open.
    const chooser=page.waitForEvent('filechooser'); await retake.click(); await (await chooser).setFiles(darkFile);
    await page.getByRole('dialog').waitFor();
    await use.click(); await page.getByRole('dialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.pending.length),1);
    assert.ok(await page.getByText(/มีคำเตือนภาพ 1 หน้า/).isVisible());
    results.layouts.push({width,theme,geometry,touch48:true,retake:true,accepted:true});
  }
  // Separate analysis (draw+readback+metric), not JPEG encode/decode, under 6x desktop CPU slowdown.
  const session=await page.context().newCDPSession(page); await session.send('Emulation.setCPUThrottlingRate',{rate:6});
  results.timing=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=2400;c.height=3200;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';
    for(let y=30;y<3200;y+=40)ctx.fillText('SYNTHETIC BILL 0123456789',20,y);
    const bitmap=await createImageBitmap(c); const times=[];
    for(let i=0;i<10;i++){const start=performance.now();window.measureBitmap(bitmap);times.push(performance.now()-start);}bitmap.close();
    return {cpuSlowdown:6,times,maxMs:Math.max(...times)};
  });
  assert.ok(results.timing.maxMs<300); assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'browser-checks.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({layouts:results.layouts.length,exif:results.exif.length,timing:results.timing}));
} finally {await browser.close();}
