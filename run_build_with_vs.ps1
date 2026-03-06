Param()

# run_build_with_vs.ps1
# Locates Visual Studio's VsDevCmd.bat, imports its environment, then runs build.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

Write-Host "Locating VsDevCmd.bat..."
$pf86 = [System.Environment]::GetEnvironmentVariable('ProgramFiles(x86)')

$vswhere = Join-Path $pf86 'Microsoft Visual Studio\\Installer\\vswhere.exe'
$vsPath = $null
if (Test-Path $vswhere) {
    try {
        $inst = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath 2>$null
        if ($inst) { $vsPath = $inst.Trim() }
    } catch {
    }
}

if (-not $vsPath) {
    $candidates = @(
        Join-Path $pf86 'Microsoft Visual Studio\\2022\\Professional',
        Join-Path $pf86 'Microsoft Visual Studio\\2022\\Community',
        Join-Path $pf86 'Microsoft Visual Studio\\2022\\BuildTools',
        Join-Path $pf86 'Microsoft Visual Studio\\2019\\Professional',
        Join-Path $pf86 'Microsoft Visual Studio\\2019\\Community',
        Join-Path $pf86 'Microsoft Visual Studio\\2019\\BuildTools'
    )
    foreach ($c in $candidates) {
        $candidateCmd = Join-Path $c 'Common7\Tools\VsDevCmd.bat'
        if (Test-Path $candidateCmd) { $vsPath = $c; break }
    }
}

if (-not $vsPath) {
    Write-Error "VsDevCmd.bat not found. Please install Visual Studio or run a Developer Command Prompt, then run build.ps1 manually."
    exit 2
}

$vsCmd = Join-Path $vsPath 'Common7\Tools\VsDevCmd.bat'
Write-Host "Using: $vsCmd"

Write-Host "Importing Visual Studio environment (this may take a few seconds)..."

# Run cmd, call VsDevCmd.bat and print the environment via `set`, capture output
$raw = & cmd.exe /c "call `"$vsCmd`" -arch=amd64 & set" 2>$null
if (-not $raw) {
    Write-Error "Failed to import environment from VsDevCmd.bat"
    exit 3
}

# Normalize and split lines
$lines = $raw -split "\r?\n"

foreach ($line in $lines) {
    if ($line -and $line -match "=") {
        $parts = $line -split('=',2)
        $name = $parts[0]
        $value = $parts[1]
        try {
            [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
        } catch {
        }
    }
}

Write-Host "Visual Studio environment imported. Running build.ps1..."

try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'build.ps1')
    exit $LASTEXITCODE
} catch {
    Write-Error "build.ps1 failed: $_"
    exit 4
}
