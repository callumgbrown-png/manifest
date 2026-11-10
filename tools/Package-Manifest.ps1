[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
    [string]$Version,

    [Parameter(Mandatory)]
    [string]$OutputDirectory,

    [string]$NodeArchive
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$nodeVersion = '24.22.2'
$nodeFolder = "node-v$nodeVersion-win-x64"
# https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
$nodeHash = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
$output = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName
$name = "Manifest-$Version-win-x64"
$zip = Join-Path $output "$name.zip"
$checksum = Join-Path $output "$name.sha256"
if ((Test-Path -LiteralPath $zip) -or (Test-Path -LiteralPath $checksum)) {
    throw "Release $Version already exists. Choose a new version or output directory."
}

$work = (New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("manifest-package-" + [guid]::NewGuid()))).FullName
Write-Host "Build staging: $work"
$originalPath = $env:Path
try {
    if (-not $NodeArchive) {
        $NodeArchive = Join-Path $work "$nodeFolder.zip"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/$nodeFolder.zip" -OutFile $NodeArchive
    }
    if ((Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash -ne $nodeHash) {
        throw "The Node archive does not match the pinned SHA-256."
    }
    Expand-Archive -LiteralPath $NodeArchive -DestinationPath $work
    $node = Join-Path $work $nodeFolder
    $env:Path = "$node;$originalPath"
    $npm = Join-Path $node 'npm.cmd'
    $build = New-Item -ItemType Directory -Path (Join-Path $work 'build')
    $buildServer = New-Item -ItemType Directory -Path (Join-Path $build 'server')
    $buildInputs = 'package.json', 'package-lock.json', 'tsconfig.json', 'src', 'test', 'public'
    foreach ($entry in $buildInputs) {
        Copy-Item -LiteralPath (Join-Path $repo "server/$entry") -Destination $buildServer -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $repo 'config') -Destination $build -Recurse

    Push-Location $buildServer
    try {
        & $npm ci --include=dev
        if ($LASTEXITCODE -ne 0) { throw 'Installing locked build dependencies failed.' }
        & $npm test
        if ($LASTEXITCODE -ne 0) { throw 'Server tests failed.' }
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'The server build failed.' }
        & $npm ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'Installing locked production dependencies failed.' }
    } finally {
        Pop-Location
    }

    $package = New-Item -ItemType Directory -Path (Join-Path $work $name)
    $packageServer = New-Item -ItemType Directory -Path (Join-Path $package 'server')
    $runtime = New-Item -ItemType Directory -Path (Join-Path $package 'runtime')
    foreach ($entry in 'dist', 'public', 'package.json', 'node_modules') {
        Copy-Item -LiteralPath (Join-Path $buildServer $entry) -Destination $packageServer -Recurse
    }
    $packageConfig = New-Item -ItemType Directory -Path (Join-Path $package 'config')
    foreach ($entry in 'rules.json', 'map.json') {
        Copy-Item -LiteralPath (Join-Path $build "config/$entry") -Destination $packageConfig
    }
    foreach ($entry in 'node.exe', 'LICENSE') {
        Copy-Item -LiteralPath (Join-Path $node $entry) -Destination $runtime
    }
    foreach ($entry in 'Play Manifest.bat', 'play.mjs', 'START-HERE.txt') {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "playtest/$entry") -Destination $package
    }
    $commit = git -C $repo rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the source commit.' }
    $sourceEdits = git -C $repo status --porcelain -- server config tools/playtest tools/Package-Manifest.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the release source status.' }
    $source = if ($sourceEdits) { "$commit + local release changes" } else { $commit }
    @("Manifest $Version", "Source: $source", "Runtime: Node $nodeVersion Windows x64") |
        Set-Content -LiteralPath (Join-Path $package 'BUILD.txt') -Encoding ascii

    Compress-Archive -LiteralPath $package -DestinationPath $zip
    $digest = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$digest  $name.zip" | Set-Content -LiteralPath $checksum -Encoding ascii
    Write-Host "Release: $zip"
    Write-Host "SHA-256: $digest"
} finally {
    $env:Path = $originalPath
}
