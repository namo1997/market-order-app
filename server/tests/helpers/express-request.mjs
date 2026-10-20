import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';

// Real Express routing, auth, body-parser and response serialization without
// listen()/network privileges. Callers retain their status/header/body assertions.
export function expressRequest(app,url,{method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const socket=new Socket();
    Object.defineProperty(socket,'remoteAddress',{value:'127.0.0.1'});
    const req=new IncomingMessage(socket);req.url=url;req.method=method;
    const bytes=body===undefined?null:Buffer.from(body);
    req.headers=Object.fromEntries(Object.entries(headers).map(([name,value])=>[name.toLowerCase(),value]));
    if(bytes)req.headers['content-length']=String(bytes.length);
    const res=new ServerResponse(req);const chunks=[];
    res.write=chunk=>{if(chunk)chunks.push(Buffer.from(chunk));return true;};
    res.end=chunk=>{
      if(chunk)chunks.push(Buffer.from(chunk));
      resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.getHeaders()}));
      socket.destroy();return res;
    };
    app.handle(req,res,error=>reject(error||Error('Unmatched Express request')));
    if(bytes)req.push(bytes);req.push(null);
  });
}
