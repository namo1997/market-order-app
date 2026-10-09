import {runtimeManifest} from './runtime-manifest.mjs';
import {loadConfig} from '../src/config.mjs';
import {createHttpServer} from '../src/http.mjs';

const config=loadConfig();
console.info(JSON.stringify(runtimeManifest()));
const server=createHttpServer(config);
server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.info(JSON.stringify({event:'business_mcp_listening',port:server.address().port})));
