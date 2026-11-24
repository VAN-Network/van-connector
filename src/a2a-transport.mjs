import {request as httpsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';
import {lookup} from 'node:dns';
import {BlockList,isIP} from 'node:net';
import {ENVIRONMENT} from './network.mjs';

const denied=new BlockList(),global6=new BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['192.88.99.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,prefix,'ipv4');
global6.addSubnet('2000::',3,'ipv6');
for(const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])denied.addSubnet(ip,prefix,'ipv6');
export function publicPeerAddress(ip){const family=isIP(ip);return family===4?!denied.check(ip,'ipv4'):family===6&&global6.check(ip,'ipv6')&&!denied.check(ip,'ipv6');}
export function peerLookup(resolve=lookup){return(host,options,callback)=>resolve(host,{all:true,verbatim:true},(error,answers)=>{if(error)return callback(Error('peer_dns_failed'));if(!answers.length||answers.some(a=>!publicPeerAddress(a.address)||isIP(a.address)!==a.family))return callback(Error('peer_nonpublic_address'));const a=answers[0];if(options?.all)callback(null,[a]);else callback(null,a.address,a.family);});}
export function validateA2APeer(input){
 const keys=['cardUrl','endpoint','protocolVersion','transport','consentRef','skill'];
 if(ENVIRONMENT!=='testnet'||!input||Object.keys(input).sort().join(',')!==keys.sort().join(',')||input.protocolVersion!=='0.3.0'||input.skill!=='van-research-report-v1'||typeof input.consentRef!=='string'||!input.consentRef.trim()||input.consentRef.length>200||!['https-public','loopback-testnet'].includes(input.transport))throw Error('invalid_a2a_peer_configuration');
 const urls=[input.cardUrl,input.endpoint].map(raw=>{const u=new URL(raw);if(u.href!==raw||u.username||u.password||u.search||u.hash)throw Error('invalid_a2a_peer_url');if(input.transport==='loopback-testnet'){if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port)throw Error('invalid_a2a_fixture_url');}else if(u.protocol!=='https:'||(u.port&&u.port!=='443')||(isIP(u.hostname.replace(/^\[|\]$/g,''))&&!publicPeerAddress(u.hostname.replace(/^\[|\]$/g,''))))throw Error('invalid_a2a_peer_url');return u;});
 if(urls[0].origin!==urls[1].origin||urls[0].href===urls[1].href)throw Error('a2a_peer_origin_mismatch');return Object.freeze({...input});
}
// Fixed, operator-reviewed URLs only. No cookies, auth/payment headers, proxy,
// redirects, connection reuse, decompression or remote artifact URL fetching.
export function createA2ATransport(input,{resolve=lookup,sendHttps=httpsRequest,sendHttp=httpRequest}={}){
 const peer=validateA2APeer(input),allowed=new Set([peer.cardUrl,peer.endpoint]);
 return async(url,body)=>{
  if(!allowed.has(url)||url===peer.cardUrl&&body!==undefined||url===peer.endpoint&&body===undefined)throw Error('a2a_route_not_allowed');
  const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));if(bytes?.length>98304)throw Error('a2a_request_too_large');
  return new Promise((resolveResult,reject)=>{
   const send=peer.transport==='loopback-testnet'?sendHttp:sendHttps;
   const req=send(new URL(url),{method:bytes?'POST':'GET',agent:false,lookup:peerLookup(resolve),rejectUnauthorized:true,maxHeaderSize:8192,signal:AbortSignal.timeout(10000),headers:{Accept:'application/json','Accept-Encoding':'identity',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},res=>{
    if(res.statusCode!==200){const reason=res.statusCode===402?'a2a_payment_not_authorized':res.statusCode===429?'a2a_rate_limited':'a2a_http_refused';res.destroy();reject(Error(reason));return;}
    if(!/^application\/json(?:\s*;|$)/i.test(String(res.headers['content-type']??''))||!['','identity'].includes(String(res.headers['content-encoding']??''))){res.destroy();reject(Error('a2a_invalid_content_type'));return;}
    const parts=[];let size=0;res.on('data',part=>{size+=part.length;if(size>131072){res.destroy();reject(Error('a2a_response_too_large'));}else parts.push(Buffer.from(part));});
    res.on('end',()=>{try{resolveResult(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))));}catch{reject(Error('a2a_invalid_json'));}});
    res.on('error',()=>reject(Error('a2a_network_error')));res.on('close',()=>{if(!res.complete)reject(Error('a2a_network_error'));});
   });req.on('error',()=>reject(Error('a2a_network_error')));req.end(bytes);
  });
 };
}
