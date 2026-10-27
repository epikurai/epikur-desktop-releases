$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Checked([string] $Name, [scriptblock] $Operation) {
    & $Operation *> (Join-Path $env:RUNNER_TEMP ($Name + '.log'))
    if ($LASTEXITCODE -ne 0) { throw ('Windows build failed: ' + $Name) }
}
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Windows x64 runner required.' }
$desktop = Join-Path $env:SOURCE_PATH 'desktop-app'
Push-Location $desktop
try {
    Checked 'npm-install' { npm ci --ignore-scripts }
    Checked 'electron-install' { node node_modules/electron/install.js }
    Checked 'browser-install' { node node_modules/playwright-core/cli.js install chromium }
    Checked 'typescript' { node node_modules/typescript/bin/tsc --noEmit }
    Checked 'renderer-build' { npm run build }
    $package = Join-Path $env:RUNNER_TEMP 'windows-package'
    $feed = 'https://raw.githubusercontent.com/epikurai/epikur-desktop-releases/feeds/channels/windows/' + $env:RELEASE_CHANNEL + '.json'
    Checked 'windows-package' { node scripts/package-windows.cjs --channel $env:RELEASE_CHANNEL --version $env:RELEASE_VERSION --source-sha $env:SOURCE_SHA --source-tree $env:SOURCE_TREE --feed-url $feed --trust-file $env:TRUST_FILE --output $package }
    [System.IO.Directory]::CreateDirectory($env:UNSIGNED_DIRECTORY) | Out-Null
    $prepare = Join-Path $env:SIGNER_PATH 'desktop-app/scripts/prepare-windows-release.cjs'
    Checked 'windows-prepare' { node $prepare --payload (Join-Path $package 'payload') --source $env:SOURCE_PATH --receipt (Join-Path $env:UNSIGNED_DIRECTORY 'prepared-windows.json') --trust $env:TRUST_FILE --archive (Join-Path $env:UNSIGNED_DIRECTORY 'unsigned-windows.zip') }
} finally { Pop-Location }
Write-Output 'Windows x64 package prepared without signing credentials.'
