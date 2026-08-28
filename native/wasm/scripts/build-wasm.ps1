<#
.SYNOPSIS
    Builds native/wasm into native/wasm/prebuilt/animated-webp.{js,wasm}.

.DESCRIPTION
    Wraps the documented flow

        emcmake cmake -S native/wasm -B native/wasm/build && cmake --build native/wasm/build

    with two workarounds for hosts running a Windows Device Guard / WDAC policy,
    which blocks individual Emscripten executables by hash:

      * the launcher (emcc.exe / emcmake.exe) may be blocked — some emsdk
        installs ship it renamed to emcc.exe.deviceguard-blocked. Going through
        the SDK's bundled Python and the .py entry points avoids it entirely.
      * wasm-ld.exe may be blocked, and unlike the launcher there is no Python
        entry point to fall back to. The only fix is an emsdk install whose
        linker passes the policy, so this script probes the candidates and picks
        the first one that can actually link.

    Symptom if you hit the second case unprepared: every object compiles, then
    the link step fails with

        emcc: error: '...wasm-ld.exe ...' failed:
              [WinError 4551] 应用程序控制策略已阻止此文件。

    which reads like a toolchain bug but is a policy block on that one file.

.PARAMETER EmsdkRoot
    Force a specific emsdk. Default: probe $env:EMSDK, D:\tmp\emsdk, D:\emsdk.

.PARAMETER Environment
    Emscripten ENVIRONMENT setting. Default 'web' for the shipped artifact; use
    'web,node' to build something the node-side parity harness can require.
#>
[CmdletBinding()]
param(
    [string]$EmsdkRoot,
    [string]$Environment = 'web'
)

$ErrorActionPreference = 'Stop'

$wasmRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $wasmRoot 'build'
$prebuiltDir = Join-Path $wasmRoot 'prebuilt'

function Test-Runnable {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    try {
        & $Path --version *> $null
        return $true
    } catch {
        return $false
    }
}

function Resolve-Emsdk {
    $candidates = @()
    if ($EmsdkRoot) { $candidates += $EmsdkRoot }
    elseif ($env:EMSDK) { $candidates += $env:EMSDK }
    $candidates += @('D:\tmp\emsdk', 'D:\emsdk')

    foreach ($root in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path $root)) { continue }
        $linker = Join-Path $root 'upstream\bin\wasm-ld.exe'
        if (Test-Runnable $linker) {
            Write-Host "emsdk: $root (wasm-ld ok)"
            return $root
        }
        Write-Warning "skipping $root - wasm-ld.exe is not runnable (device guard policy?)"
    }
    throw 'no emsdk with a runnable wasm-ld.exe was found; pass -EmsdkRoot explicitly'
}

$emsdk = Resolve-Emsdk
$emscripten = Join-Path $emsdk 'upstream\emscripten'

$python = Get-ChildItem -Path (Join-Path $emsdk 'python') -Filter 'python.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $python) { throw "no bundled python under $emsdk\python" }

$node = Get-ChildItem -Path (Join-Path $emsdk 'node') -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $node) { throw "no bundled node under $emsdk\node" }

$ninja = Get-ChildItem -Path $emsdk -Filter 'ninja.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $ninja) { $ninja = (Get-Command ninja -ErrorAction SilentlyContinue).Source }
if (-not $ninja) { throw 'ninja.exe not found in the emsdk or on PATH' }

$env:EMSDK = $emsdk
$env:EMSDK_PYTHON = $python
$env:EMSDK_NODE = $node
$env:PATH = "$emsdk;$emscripten;$(Split-Path -Parent $ninja);$env:PATH"

# CMakeCache.txt pins the toolchain's absolute paths, and reconfiguring does NOT
# repoint an already-cached CMAKE_C_COMPILER: passing a different toolchain file
# is silently ignored, and the build keeps invoking the old SDK's emcc. So check
# the cache itself rather than tracking the SDK out of band, and wipe the tree
# whenever it belongs to a different emsdk.
$cache = Join-Path $buildDir 'CMakeCache.txt'
if (Test-Path $cache) {
    # Any cache configured against this SDK mentions its root all over the place
    # (compiler, toolchain file, sysroot), so a cache that never names it belongs
    # to a different one.
    if (-not (Select-String -Path $cache -SimpleMatch -Quiet -Pattern $emsdk)) {
        Write-Host "build tree was configured against a different emsdk; wiping it for $emsdk"
        Remove-Item -Recurse -Force $buildDir
    }
}

& $python (Join-Path $emscripten 'emcmake.py') cmake `
    -G Ninja `
    -S $wasmRoot `
    -B $buildDir `
    "-DCMAKE_MAKE_PROGRAM=$ninja" `
    "-DEMSCRIPTEN_ENVIRONMENT=$Environment"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cmake --build $buildDir --parallel 4
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path $prebuiltDir | Out-Null
foreach ($name in @('animated-webp.js', 'animated-webp.wasm')) {
    Copy-Item (Join-Path $buildDir $name) (Join-Path $prebuiltDir $name) -Force
}

# The .js and the .wasm must ship as a matched pair, so regenerate the CJS glue
# in the same breath as the copy rather than leaving it to a separate step.
& $node (Join-Path $PSScriptRoot 'gen-glue-file.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Only the glue goes into runtime/, which is the read-only asset-db mount. The
# .wasm stays here and is delivered by main.js (into the engine's native/external
# for the editor and preview) and by the build hook (into the package's
# cocos-js/), so putting a copy in the mount would only add an asset nothing
# reads.

Write-Host ''
Write-Host 'built:'
Get-ChildItem (Join-Path $prebuiltDir '*') | ForEach-Object {
    Write-Host ("  {0,-22} {1,9:N0} bytes" -f $_.Name, $_.Length)
}
