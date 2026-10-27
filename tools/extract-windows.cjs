'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),{execFileSync}=require('node:child_process');
(async()=>{
 const env=process.env;
 assert(path.isAbsolute(env.SIGNER_PATH));assert.match(env.TRUSTED_SIGNER_SHA,/^[a-f0-9]{40}$/);
 assert.equal(execFileSync('git',['-C',env.SIGNER_PATH,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),env.TRUSTED_SIGNER_SHA);
 const privateFiles=require(path.join(env.SIGNER_PATH,'desktop-app/desktop/private-filesystem.cjs'));
 await privateFiles.ensurePrivateDirectory(env.UNSIGNED_DIRECTORY);
 assert.deepEqual((await fs.readdir(env.UNSIGNED_DIRECTORY)).sort(),['prepared-windows.json','unsigned-windows.zip']);
 const archive=require(path.join(env.SIGNER_PATH,'desktop-app/desktop/windows-update-archive.cjs'));
 await archive.extractUnsignedArchive(path.join(env.UNSIGNED_DIRECTORY,'unsigned-windows.zip'),env.UNSIGNED_EXTRACTION);
})().catch(()=>{console.error('Unsigned Windows package extraction failed.');process.exitCode=1});
