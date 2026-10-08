import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {storage} from './ssd-storage.mjs';
// สำเนาภาพอยู่ใน image root ของ preview จึงผ่าน path guard เดิมโดยไม่ลดการป้องกัน
export const copyPreviewImages = async (db,data,sourceRoot,fallbackRoot=null) => {
  storage.assertSSD();storage.assertSSDPath(data);storage.assertSSDPath(sourceRoot);
  const destination=path.join(data,'images'),copied=new Set();await fs.mkdir(destination,{recursive:true});
  for(const row of db.prepare('SELECT id,storage_relative_path FROM capture_items WHERE storage_relative_path IS NOT NULL').all()) {
    const target=path.resolve(destination,row.storage_relative_path);if(!target.startsWith(destination+path.sep))throw Error('Invalid image relative path');
    if(!copied.has(target)){
      let source=path.resolve(sourceRoot,row.storage_relative_path);if(!source.startsWith(path.resolve(sourceRoot)+path.sep))throw Error('Invalid image source');
      let found=true;try{await fs.access(source);}catch{found=false;}
      if(!found&&fallbackRoot){storage.assertSSDPath(fallbackRoot);source=path.resolve(fallbackRoot,row.storage_relative_path);if(!source.startsWith(path.resolve(fallbackRoot)+path.sep))throw Error('Invalid fallback');try{await fs.access(source);found=true;}catch{}}
      if(found){await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target,constants.COPYFILE_FICLONE);}
      copied.add(target);
    }
    db.prepare('UPDATE capture_items SET storage_path=? WHERE id=?').run(target,row.id);
  }
};
