export const NETWORK=Object.freeze({profileId:'base-sepolia',chainId:84532,network:'eip155:84532',asset:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',decimals:6,audience:'https://test-api.thevan.app'});
export function validateIdentity(config){
 if(!config||config.chainId!==NETWORK.chainId||config.origin!==NETWORK.audience||
  (config.profileId!==undefined&&config.profileId!==NETWORK.profileId))throw Error('State belongs to a different VAN network or API; preserve it and use a separate state directory');
 return config;
}
export function validateDescriptor(d){
 if(!d||d.version!==1||Object.keys(d).sort().join(',')!=='asset,audience,chainId,decimals,network,profileId,version'||Object.keys(NETWORK).some(k=>d[k]!==NETWORK[k]))throw Error('Server network context mismatch; no credential or payment sent');
 return d;
}
