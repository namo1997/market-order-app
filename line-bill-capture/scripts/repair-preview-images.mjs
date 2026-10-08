import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {storage} from './ssd-storage.mjs';import {copyPreviewImages} from './preview-image-copy.mjs';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');storage.assertSSD();
const report=JSON.parse(await fs.readFile(storage.assertSSDPath(process.argv[2]),'utf8'));assert.equal(report.mock_line,true);assert.equal(report.ai_worker,false);
const image=JSON.parse(await fs.readFile(storage.assertSSDPath(report.images_manifest),'utf8'));
const file=storage.assertSSDPath(report.working_db);assert.notEqual(file,report.source_snapshot);
const db=new DatabaseSync(file);await copyPreviewImages(db,path.dirname(file),image.root);db.close();console.log('Preview images copied into isolated image root; original guard preserved');
