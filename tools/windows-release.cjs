'use strict';
// Public Windows release validation. No candidate application code is loaded here.
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const shared=require('./release-automation.cjs');
const REPOSITORY=shared.REPOSITORY,MAX=1024*1024*1024;
const IDENTITIES=Object.freeze({qa:{bundleId:'ai.epikur.desktop2.windows.qa',name:'Epikur QA Windows'},stable:{bundleId:'ai.epikur.desktop2.windows',name:'Epikur Windows'}});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const channel=value=>{assert(Object.hasOwn(IDENTITIES,value),'Invalid Windows channel');return value};
const versionFor=shared.versionFor;
const tagFor=(selected,version)=>'windows-'+channel(selected)+'-'+version;
const keyId=selected=>'epikur-desktop-windows-'+channel(selected);
const releaseId=(selected,version,sha)=>'windows-'+channel(selected)+'-'+version+'-'+sha;
const feedURL=selected=>'https://raw.githubusercontent.com/'+REPOSITORY+'/feeds/channels/windows/'+channel(selected)+'.json';
const artifactName=(selected,version)=>(channel(selected)==='qa'?'Epikur-QA-Windows':'Epikur-Windows')+'-'+version+'-win32-x64.zip';
const installerName=(selected,version)=>(channel(selected)==='qa'?'Epikur-QA-Windows':'Epikur-Windows')+'-'+version+'-Setup.exe';
const assetURL=(selected,version,name)=>'https://github.com/'+REPOSITORY+'/releases/download/'+tagFor(selected,version)+'/'+name;
const artifactURL=(selected,version)=>assetURL(selected,version,artifactName(selected,version));
const installerURL=(selected,version)=>assetURL(selected,version,installerName(selected,version));
function candidate(value,ref){assert(exact(value,['schema','sourceSha','sourceTree'])&&value.schema===1&&validSha(value.sourceSha)&&validSha(value.sourceTree));assert.equal(ref,'refs/heads/requests/windows-qa/'+value.sourceSha);return value}
function trustFor(selected,pem,certificate){channel(selected);shared.publicKey(pem);assert.match(certificate||'',/^[a-f0-9]{64}$/,'Windows publisher certificate must be configured');return {enabled:true,platform:'win32-x64',channel:selected,origins:['https://raw.githubusercontent.com','https://github.com'],githubReleaseRepository:REPOSITORY,keys:{[keyId(selected)]:pem},signing:{bundleId:IDENTITIES[selected].bundleId,certificateSha256:certificate}}}
function decode(value,size){assert(typeof value==='string'&&value.length<=65536&&/^[A-Za-z0-9+/]+={0,2}$/.test(value));const bytes=Buffer.from(value,'base64');assert.equal(bytes.toString('base64'),value);if(size)assert.equal(bytes.length,size);return bytes}
function verifyEnvelope(envelope,selected,pem){
 channel(selected);assert(exact(envelope,['key_id','manifest','signature']));assert.equal(envelope.key_id,keyId(selected));const bytes=decode(envelope.manifest),signature=decode(envelope.signature,64);assert(bytes.length>0&&bytes.length<=16384);assert(crypto.verify(null,bytes,shared.publicKey(pem),signature),'Invalid Windows manifest signature');
 const value=JSON.parse(bytes.toString('utf8'));assert.equal(JSON.stringify(value),bytes.toString('utf8'),'Manifest must be unambiguous canonical JSON');
 assert(exact(value,['schema','release_id','component','channel','bundle_id','version','platform','stream_protocol','state_schema','source_sha','source_tree','artifact','installer']));
 for(const [key,expected]of Object.entries({schema:2,component:'desktop_windows',channel:selected,bundle_id:IDENTITIES[selected].bundleId,platform:'win32-x64',stream_protocol:1,state_schema:1}))assert.equal(value[key],expected);
 assert(validSha(value.source_sha)&&validSha(value.source_tree));const match=/^2\.0\.([1-9][0-9]{0,11})(?:-qa\.1)?$/.exec(value.version);assert(match);assert.equal(value.version,versionFor(selected,match[1]));assert.equal(value.release_id,releaseId(selected,value.version,value.source_sha));
 for(const [field,url]of [['artifact',artifactURL(selected,value.version)],['installer',installerURL(selected,value.version)]]){const file=value[field];assert(exact(file,['url','sha256','size']));assert.equal(file.url,url);assert.match(file.sha256,/^[a-f0-9]{64}$/);assert(Number.isSafeInteger(file.size)&&file.size>0&&file.size<=MAX)}
 return value;
}
function verifyReceipt(receipt,value,certificate){
 assert(receipt?.schema===1&&receipt.kind==='signed-windows-desktop-release');
 for(const [key,expected]of Object.entries({channel:value.channel,version:value.version,sourceSha:value.source_sha,sourceTree:value.source_tree,platform:'win32-x64',bundleId:IDENTITIES[value.channel].bundleId,certificateSha256:certificate}))assert.equal(receipt[key],expected,'Windows receipt '+key+' differs');
 assert.match(receipt.payloadSha256,/^[a-f0-9]{64}$/);assert.equal(receipt.launcherProtocol,1);
 for(const key of ['authenticode','payloadInventory','channelIdentity'])assert.equal(receipt.checks?.[key],true);
 for(const [field,manifestField,name]of [['archive','artifact',artifactName(value.channel,value.version)],['installer','installer',installerName(value.channel,value.version)]]){assert.equal(receipt[field]?.file,name);assert.equal(receipt[field].sha256,value[manifestField].sha256);assert.equal(receipt[field].size,value[manifestField].size)}return receipt;
}
async function regular(file,limit=65536){const stat=await fs.lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=limit);return stat}
async function readJSON(file,limit=65536){await regular(file,limit);return JSON.parse(await fs.readFile(file,'utf8'))}
async function hashFile(file){const hash=crypto.createHash('sha256');for await(const bytes of sync.createReadStream(file))hash.update(bytes);return hash.digest('hex')}
async function verifyBundle(directory,selected,pem,certificate){
 const envelope=await readJSON(path.join(directory,'manifest.json')),value=verifyEnvelope(envelope,selected,pem),receipt=verifyReceipt(await readJSON(path.join(directory,'windows-release.json')),value,certificate);
 const files=[artifactName(selected,value.version),installerName(selected,value.version),'windows-release.json','manifest.json'];assert.deepEqual((await fs.readdir(directory)).sort(),files.sort(),'Unexpected public Windows files');
 for(const [field,name]of [['artifact',artifactName(selected,value.version)],['installer',installerName(selected,value.version)]]){const file=path.join(directory,name),stat=await regular(file,MAX);assert.equal(stat.size,value[field].size);assert.equal(await hashFile(file),value[field].sha256)}return {envelope,value,receipt,files};
}
function shouldPublish(existing,next,pem){if(!existing)return true;const current=verifyEnvelope(existing,next.channel,pem),number=v=>Number(/^2\.0\.([0-9]+)/.exec(v)[1]);if(number(current.version)>number(next.version))return false;if(current.version===next.version){assert.equal(current.artifact.sha256,next.artifact.sha256,'Windows release version is immutable');assert.equal(current.installer.sha256,next.installer.sha256);assert.equal(current.source_sha,next.source_sha);return false}return true}
function promotion({envelope,receipt,qaTag,pem,selected,number,certificate}){const qa=verifyEnvelope(envelope,'qa',pem);assert.equal(qaTag,tagFor('qa',qa.version));verifyReceipt(receipt,qa,certificate);const version=versionFor(selected,number);return {channel:selected,sourceSha:qa.source_sha,sourceTree:qa.source_tree,version,tag:tagFor(selected,version),releaseId:releaseId(selected,version,qa.source_sha)}}
async function requestJSON(endpoint,token){assert(endpoint.startsWith('repos/'+REPOSITORY+'/'));const response=await fetch('https://api.github.com/'+endpoint,{headers:{Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})},redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok);const text=await response.text();assert(Buffer.byteLength(text)<=2*1024*1024);return JSON.parse(text)}
async function download(url,{size,sha256}={}){
 const initial=new URL(url);assert(initial.origin==='https://github.com'&&initial.pathname.startsWith('/'+REPOSITORY+'/releases/download/')&&!initial.search&&!initial.hash&&!initial.username&&!initial.password);
 const response=await fetch(url,{credentials:'omit',redirect:'follow',signal:AbortSignal.timeout(size?300000:60000)});assert(response.ok);const final=new URL(response.url);assert(final.protocol==='https:'&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname)&&!final.username&&!final.password);
 const hash=crypto.createHash('sha256'),chunks=[];let count=0;for await(const chunk of response.body){count+=chunk.length;assert(count<=(size||65536));hash.update(chunk);if(!sha256)chunks.push(chunk)}if(size)assert.equal(count,size);if(sha256){assert.equal(hash.digest('hex'),sha256);return}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function resolve({root,output,env=process.env}){
 assert.equal(env.GITHUB_REF,'refs/heads/main');const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();let result;
 if(env.GITHUB_EVENT_NAME==='workflow_run'){
  const event=await readJSON(env.GITHUB_EVENT_PATH,2*1024*1024),run=event.workflow_run;assert.equal(run?.conclusion,'success');assert.equal(run.head_repository?.full_name,REPOSITORY);assert(validSha(run.head_sha));assert.match(run.head_branch,/^requests\/windows-qa\/[a-f0-9]{40}$/);git(['fetch','origin',run.head_sha]);
  assert.equal(git(['diff','--name-only',run.head_sha+'^',run.head_sha]),'windows-candidate.json');git(['merge-base','--is-ancestor',run.head_sha+'^','origin/main']);const value=candidate(JSON.parse(git(['show',run.head_sha+':windows-candidate.json'])),'refs/heads/'+run.head_branch),version=versionFor('qa',env.GITHUB_RUN_NUMBER);
  result={channel:'qa',sourceSha:value.sourceSha,sourceTree:value.sourceTree,version,tag:tagFor('qa',version),releaseId:releaseId('qa',version,value.sourceSha)};
 }else{
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');const selected=channel(env.INPUT_CHANNEL),tag=env.INPUT_QA_TAG;assert.match(tag||'',/^windows-qa-2\.0\.[1-9][0-9]{0,11}-qa\.1$/);
  const release=await requestJSON('repos/'+REPOSITORY+'/releases/tags/'+tag,env.GH_TOKEN);assert.equal(release.tag_name,tag);assert.equal(release.draft,false);assert.equal(release.prerelease,true);
  const asset=name=>{const matches=release.assets.filter(item=>item.name===name);assert.equal(matches.length,1);const url='https://github.com/'+REPOSITORY+'/releases/download/'+tag+'/'+name;assert.equal(matches[0].browser_download_url,url);return url};
  result=promotion({envelope:await download(asset('manifest.json')),receipt:await download(asset('windows-release.json')),qaTag:tag,pem:await fs.readFile(path.join(root,'keys/windows-qa.pem'),'utf8'),selected,number:env.GITHUB_RUN_NUMBER,certificate:env.WINDOWS_CERTIFICATE_SHA256});
 }
 result.automationSha=git(['rev-parse','HEAD']);result.trustedSignerSha=env.TRUSTED_SIGNER_SHA;assert(validSha(result.automationSha)&&validSha(result.trustedSignerSha));
 const values={channel:result.channel,source_sha:result.sourceSha,source_tree:result.sourceTree,version:result.version,tag:result.tag,release_id:result.releaseId,automation_sha:result.automationSha,trusted_signer_sha:result.trustedSignerSha};await fs.appendFile(output,Object.entries(values).map(([key,value])=>key+'='+value+'\n').join(''));return result;
}
async function verifyUploaded(bundle,token){
 const {value}=bundle,tag=tagFor(value.channel,value.version),release=await requestJSON('repos/'+REPOSITORY+'/releases/tags/'+tag,token);assert.equal(release.draft,false);assert.equal(release.prerelease,value.channel==='qa');
 for(const name of bundle.files){const rows=release.assets.filter(asset=>asset.name===name);assert.equal(rows.length,1);assert.equal(rows[0].browser_download_url,assetURL(value.channel,value.version,name))}
 await download(value.artifact.url,value.artifact);await download(value.installer.url,value.installer);
 assert.deepEqual(await download(assetURL(value.channel,value.version,'manifest.json')),bundle.envelope);assert.deepEqual(await download(assetURL(value.channel,value.version,'windows-release.json')),bundle.receipt);
}
async function updateFeed({root,bundle,pem,history}){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),selected=bundle.value.channel,relative='channels/windows/'+selected+'.json';
 for(let attempt=0;attempt<4;attempt++){
  git(['fetch','origin','refs/heads/feeds']);git(['checkout','--detach','FETCH_HEAD']);let existing;try{existing=await readJSON(path.join(root,relative))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!shouldPublish(existing,bundle.value,pem))return false;if(existing&&!shared.sourceCanAdvance(history,verifyEnvelope(existing,selected,pem).source_sha,bundle.value.source_sha))return false;
  await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await fs.writeFile(path.join(root,relative),JSON.stringify(bundle.envelope)+'\n');const receipt='channels/windows/'+selected+'-receipt.json';await fs.writeFile(path.join(root,receipt),JSON.stringify(bundle.receipt)+'\n');git(['add','--',relative,receipt]);git(['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','release: publish Windows '+selected+' '+bundle.value.version]);try{git(['push','origin','HEAD:refs/heads/feeds']);return true}catch{if(attempt===3)throw Error('Concurrent Windows publication did not settle')}
 }
}
async function main(command,env=process.env){
 const root=process.cwd();if(command==='resolve')return resolve({root,output:env.GITHUB_OUTPUT,env});
 const selected=channel(env.RELEASE_CHANNEL),pem=await fs.readFile(path.join(root,'keys/windows-'+selected+'.pem'),'utf8'),certificate=env.WINDOWS_CERTIFICATE_SHA256;
 if(command==='trust'){await fs.writeFile(env.TRUST_FILE,JSON.stringify(trustFor(selected,pem,certificate))+'\n',{flag:'wx'});return}
 if(command==='sign-manifest'){
  const receipt=await readJSON(path.join(env.RELEASE_DIRECTORY,'windows-release.json')),version=env.RELEASE_VERSION;
  const manifest={schema:2,release_id:releaseId(selected,version,env.SOURCE_SHA),component:'desktop_windows',channel:selected,bundle_id:IDENTITIES[selected].bundleId,version,platform:'win32-x64',stream_protocol:1,state_schema:1,source_sha:env.SOURCE_SHA,source_tree:env.SOURCE_TREE,artifact:{url:artifactURL(selected,version),sha256:receipt.archive?.sha256,size:receipt.archive?.size},installer:{url:installerURL(selected,version),sha256:receipt.installer?.sha256,size:receipt.installer?.size}};
  verifyReceipt(receipt,manifest,certificate);const bytes=Buffer.from(JSON.stringify(manifest)),privateKey=crypto.createPrivateKey(env.MANIFEST_KEY);assert.equal(privateKey.asymmetricKeyType,'ed25519');const envelope={key_id:keyId(selected),manifest:bytes.toString('base64'),signature:crypto.sign(null,bytes,privateKey).toString('base64')};verifyEnvelope(envelope,selected,pem);await fs.writeFile(path.join(env.RELEASE_DIRECTORY,'manifest.json'),JSON.stringify(envelope)+'\n',{flag:'wx'});return;
 }
 const bundle=await verifyBundle(env.RELEASE_DIRECTORY,selected,pem,certificate);
 for(const [field,key]of [['source_sha','EXPECTED_SOURCE_SHA'],['source_tree','EXPECTED_SOURCE_TREE'],['version','EXPECTED_VERSION']])if(env[key])assert.equal(bundle.value[field],env[key]);if(env.EXPECTED_TAG)assert.equal(tagFor(selected,bundle.value.version),env.EXPECTED_TAG);
 if(command==='verify-upload')return verifyUploaded(bundle,env.GH_TOKEN);
 if(command==='update-feed')return updateFeed({root,bundle,pem,history:env.SOURCE_HISTORY});
 assert.equal(command,'verify-bundle');if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,'tag='+tagFor(selected,bundle.value.version)+'\nversion='+bundle.value.version+'\n');
}
module.exports={candidate,trustFor,verifyEnvelope,verifyReceipt,verifyBundle,shouldPublish,promotion,resolve,updateFeed,versionFor,tagFor,keyId,releaseId,feedURL,artifactName,installerName,artifactURL,installerURL,IDENTITIES,main};
if(require.main===module)main(process.argv[2]).then(()=>console.log('Windows release validation passed.')).catch(()=>{console.error('Windows release validation failed.');process.exitCode=1});
