$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:WINDOWS_SIGNING_PROVIDER -ne 'certificate') { throw 'Configure the reviewed Windows signing provider before publication.' }
if (!$env:WINDOWS_PFX_BASE64 -or !$env:WINDOWS_PFX_PASSWORD) { throw 'Windows signing certificate is not configured.' }
$pfx = Join-Path $env:RUNNER_TEMP 'windows-signing.pfx'
$certificate = $null
try {
    [System.IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64))
    $password = ConvertTo-SecureString $env:WINDOWS_PFX_PASSWORD -AsPlainText -Force
    Remove-Item Env:WINDOWS_PFX_BASE64, Env:WINDOWS_PFX_PASSWORD
    $certificate = Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $password
    Remove-Item -LiteralPath $pfx -Force
    if (@($certificate).Count -ne 1) { throw 'Select exactly one Windows signing identity.' }
    $env:WINDOWS_CERTIFICATE_SHA1 = $certificate.Thumbprint
    $tools = @(Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory | Where-Object Name -Match '^10\.[0-9.]+$' | Sort-Object { [version]$_.Name } -Descending)
    $env:WINDOWS_SIGNTOOL_PATH = Join-Path $tools[0].FullName 'x64\signtool.exe'
    # Only reviewed signer code executes on this runner; candidate bytes are data.
    node (Join-Path $PSScriptRoot 'extract-windows.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Windows unsigned archive validation failed.' }
    $signer = Join-Path $env:SIGNER_PATH 'desktop-app/scripts/sign-windows-release.cjs'
    node $signer --input-payload (Join-Path $env:UNSIGNED_EXTRACTION 'payload') --source $env:SOURCE_PATH --prepared-receipt (Join-Path $env:UNSIGNED_DIRECTORY 'prepared-windows.json') --trust $env:TRUST_FILE --output $env:RELEASE_DIRECTORY --scratch (Join-Path $env:RUNNER_TEMP 'windows-signing-scratch') *> (Join-Path $env:RUNNER_TEMP 'windows-signing.log')
    if ($LASTEXITCODE -ne 0) { throw 'Windows signing or independent verification failed.' }
} finally {
    if ($certificate) { $certificate | ForEach-Object { Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $_.Thumbprint) -Force -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
    Remove-Item Env:WINDOWS_PFX_BASE64, Env:WINDOWS_PFX_PASSWORD, Env:WINDOWS_CERTIFICATE_SHA1 -ErrorAction SilentlyContinue
}
Write-Output 'Windows payload, verifier, launcher and installer independently verified.'
