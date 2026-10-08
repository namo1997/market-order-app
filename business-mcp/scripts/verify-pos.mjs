// Actual source read check only; no fixtures, business values or credential output.
import {loadConfig} from '../src/config.mjs';
import {createService} from '../src/service.mjs';
const config=loadConfig();
const client=config.clients.find(x=>x.name===process.env.BUSINESS_VERIFY_CLIENT);
if (!client) {console.error('Configured BUSINESS_VERIFY_CLIENT required');process.exitCode=1;}
else {
  const service=createService(config,client);
  const requested=process.argv.slice(2);
  const branches=requested.length?requested:client.branches;
  const results=[];
  for(const branch of branches) {
    try {
      const listed=await service.posList({branch,limit:1});
      const first=listed.receipts[0];
      if(first) await service.posDetail({branch,from:listed.period.from,to:listed.period.to,docno:first.docno,limit:1});
      results.push({branch,status:'SOURCE_READ_PASS',as_of:listed.as_of,period:listed.period,header_read:true,detail_read:Boolean(first),classification_verified:listed.coverage.classification_verified,seller:'UNVERIFIED',coverage:listed.status});
    } catch(error) {
      results.push({branch,status:'SOURCE_READ_FAILED',reason:error.message.replace(/https?:\/\/\S+/g,'[upstream]')});process.exitCode=1;
    }
  }
  console.log(JSON.stringify({check:'ACTUAL_POS_SOURCE_READ',results},null,2));
}
