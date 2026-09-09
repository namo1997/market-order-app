import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStatementFile} from './statementValidation.js';
const metadata={declaredDepositCount:2,declaredDepositTotal:100.01,periodFrom:'2026-08-01',periodTo:'2026-08-31'};
const rows=[{date:'2026-08-01',amount:40},{date:'2026-08-31',amount:60.01}];
const account={status:'MATCHED'};
test('complete statement controls pass to the satang',()=>assert.equal(validateStatementFile(metadata,rows,account).can_confirm,true));
test('a missing row or even one satang mismatch blocks confirmation',()=>{
assert.equal(validateStatementFile(metadata,rows.slice(0,1),account).can_confirm,false);
assert.equal(validateStatementFile({...metadata,declaredDepositTotal:100},rows,account).can_confirm,false);
});
test('missing controls, unknown account and out of period dates block confirmation',()=>{
assert.equal(validateStatementFile({},rows,account).can_confirm,false);
assert.equal(validateStatementFile(metadata,rows,{status:'UNKNOWN'}).can_confirm,false);
assert.equal(validateStatementFile(metadata,[rows[0],{...rows[1],date:'2026-09-01'}],account).can_confirm,false);
assert.equal(validateStatementFile({...metadata,periodFrom:'2026-02-30'},rows,account).can_confirm,false);
});
