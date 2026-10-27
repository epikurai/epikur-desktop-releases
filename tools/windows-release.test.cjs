'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const api=require('./windows-release.cjs');
const pair=crypto.generateKeyPairSync('ed25519'),pem=pair.publicKey.export({type:'spki',format:'pem'}),cert='c'.repeat(64),sha='a'.repeat(40),tree='b'.repeat(40);
function envelope(channel='qa'){
 const version=api.versionFor(channel,1),file=(installer=false)=>({url:installer?api.installerURL(channel,version):api.artifactURL(channel,version),sha256:'d'.repeat(64),size:100});
 const value={schema:2,release_id:api.releaseId(channel,version,sha),component:'desktop_windows',channel,bundle_id:api.IDENTITIES[channel].bundleId,version,platform:'win32-x64',stream_protocol:1,state_schema:1,source_sha:sha,source_tree:tree,artifact:file(),installer:file(true)};
 const sign=value=>{const bytes=Buffer.from(JSON.stringify(value));return {key_id:api.keyId(channel),manifest:bytes.toString('base64'),signature:crypto.sign(null,bytes,pair.privateKey).toString('base64')}};
 return {value,envelope:sign(value),sign};
}
test('Windows identities, trust and public addresses are independent from Mac',()=>{
 assert.equal(api.feedURL('qa'),'https://raw.githubusercontent.com/epikurai/epikur-desktop-releases/feeds/channels/windows/qa.json');
 assert.equal(api.tagFor('stable','2.0.1'),'windows-stable-2.0.1');
 assert.equal(api.trustFor('qa',pem,cert).signing.bundleId,'ai.epikur.desktop2.windows.qa');
 assert.throws(()=>api.trustFor('qa',pem,''));assert.throws(()=>api.candidate({schema:1,sourceSha:sha,sourceTree:tree},'refs/heads/requests/qa/'+sha));
});
test('Windows manifests bind source, platform, channel, payload and bootstrap installer',()=>{
 const f=envelope();assert.equal(api.verifyEnvelope(f.envelope,'qa',pem).source_sha,sha);
 for(const changes of [{component:'desktop_mac'},{platform:'darwin-arm64'},{bundle_id:'ai.epikur.desktop2.qa'},{source_sha:tree},{artifact:{...f.value.artifact,url:f.value.artifact.url.replace('windows-qa-','qa-')}},{installer:{...f.value.installer,url:'https://example.test/a.exe'}}])assert.throws(()=>api.verifyEnvelope(f.sign({...f.value,...changes}),'qa',pem));
 assert.throws(()=>api.verifyEnvelope(f.envelope,'stable',pem));
});
test('ambiguous signed JSON and invalid signatures are rejected',()=>{
 const f=envelope(),bytes=Buffer.from(JSON.stringify(f.value).replace('"schema":2','"schema":1,"schema":2'));
 assert.throws(()=>api.verifyEnvelope({...f.envelope,manifest:bytes.toString('base64'),signature:crypto.sign(null,bytes,pair.privateKey).toString('base64')},'qa',pem));
 assert.throws(()=>api.verifyEnvelope({...f.envelope,signature:Buffer.alloc(64).toString('base64')},'qa',pem));
});
test('feed updates cannot roll back or replace an immutable Windows release',()=>{
 const f=envelope();assert.equal(api.shouldPublish(f.envelope,f.value,pem),false);
 assert.throws(()=>api.shouldPublish(f.envelope,{...f.value,artifact:{...f.value.artifact,sha256:'e'.repeat(64)}},pem));
 assert.equal(api.shouldPublish(f.envelope,{...f.value,version:'2.0.2-qa.1'},pem),true);
});
test('Windows release automation isolates candidate execution, signing and human publication approval',()=>{
 const fs=require('node:fs'),path=require('node:path'),workflow=fs.readFileSync(path.resolve(__dirname,'../.github/workflows/desktop-windows-release.yml'),'utf8');
 const build=workflow.split('\n  build:\n')[1].split('\n  sign:\n')[0],sign=workflow.split('\n  sign:\n')[1].split('\n  publish:\n')[0],publish=workflow.split('\n  publish:\n')[1];
 assert.doesNotMatch(build,/WINDOWS_PFX|MANIFEST_KEY|desktop-windows-signing/);assert.match(sign,/environment: desktop-windows-signing/);assert.match(sign,/ref: \$\{\{ needs\.inspect\.outputs\.automation_sha \}\}/);assert.match(sign,/tools\/windows-sign\.ps1/);
 assert.match(publish,/desktop-windows-live/);assert.doesNotMatch(publish,/environment:.*'desktop-live'/);assert.match(workflow,/EPIKUR_WINDOWS_RELEASE_ENABLED/);assert.doesNotMatch(workflow,/channels\/qa\.json|channels\/stable\.json/);
});
