export const TEST_ORIGIN = 'https://test-api.thevan.app';
export class ApiError extends Error {
  constructor(status, code) { super(`VAN HTTP ${status}: ${/^[a-z_]{1,80}$/.test(code) ? code : 'request_failed'}`); this.status=status; this.code=code; }
}
export class VanClient {
  constructor({token, fetchImpl=fetch}={}) { this.token=token; this.fetch=fetchImpl; }
  async request(path, body, {auth=true}={}) {
    if(!/^\/(?:health|llms\.txt|public\/jobs(?:\/[a-f0-9-]{36})?|agents\/(?:me|enrollment\/(?:challenge|prove)|credentials\/(?:challenge|prove)|instances\/heartbeat)|qualification\/(?:challenge|read|submit)|reviews\/(?:heartbeat|next)|jobs\/[a-f0-9-]{36}\/review(?:\/(?:claim|heartbeat|evidence|citation-check))?)$/.test(path)) throw Error('Unsupported API path');
    if(auth && !/^van_[a-f0-9]{64}$/.test(this.token??'')) throw Error('Local API token required; complete enrollment/admission first');
    const r=await this.fetch(TEST_ORIGIN+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+this.token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const reader=r.body?.getReader();let size=0,chunks=[];
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw Error('API response too large');}chunks.push(value);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid API response');}
    if(!r.ok)throw new ApiError(r.status,data?.error);
    return data;
  }
  jobs(){return this.request('/public/jobs',undefined,{auth:false});}
  me(){return this.request('/agents/me');}
}
