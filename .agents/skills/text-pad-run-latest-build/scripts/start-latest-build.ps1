[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [DateTimeOffset]$BuiltAfter
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $PSScriptRoot '..\..\..\..')
    )
}

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$targetPath = Join-Path $repository 'src-tauri\target\release\text-pad.exe'
if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "최신 릴리스 실행 파일이 없습니다: $targetPath"
}

$target = Get-Item -LiteralPath $targetPath
if ($PSBoundParameters.ContainsKey('BuiltAfter') -and $target.LastWriteTimeUtc -lt $BuiltAfter.UtcDateTime) {
    throw "릴리스 실행 파일이 요구한 빌드 시작 시각보다 오래됐습니다: $($target.LastWriteTime.ToString('o'))"
}

$running = @(Get-Process text-pad -ErrorAction SilentlyContinue)
$matching = @()
$other = @()
foreach ($candidate in $running) {
    $candidatePath = $candidate.Path
    if ($candidatePath -and [string]::Equals(
        $candidatePath,
        $target.FullName,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        $matching += $candidate
    } else {
        $other += [pscustomobject]@{
            processId = $candidate.Id
            path = $candidatePath
        }
    }
}

if ($other.Count -gt 0) {
    $details = $other | ConvertTo-Json -Compress
    throw "다른 경로의 text-pad가 실행 중입니다. 저장되지 않은 문서를 보호하기 위해 자동 종료하지 않습니다: $details"
}
if ($matching.Count -gt 1) {
    throw "최신 로컬 빌드 프로세스가 둘 이상 실행 중입니다: $($matching.Id -join ', ')"
}

$launchStatus = 'started'
if ($matching.Count -eq 1) {
    $launched = $matching[0]
    $launchStatus = 'alreadyRunning'
} else {
    $launched = Start-Process `
        -FilePath $target.FullName `
        -WorkingDirectory $target.DirectoryName `
        -WindowStyle Normal `
        -PassThru
}

$actualPath = $null
$windowReady = $false
for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    Start-Sleep -Milliseconds 100
    $launched.Refresh()
    if ($launched.HasExited) {
        throw "최신 로컬 빌드가 창을 준비하기 전에 종료됐습니다. 종료 코드: $($launched.ExitCode)"
    }
    $actualPath = $launched.Path
    $windowReady = $launched.MainWindowHandle -ne 0
    if ($actualPath -and $windowReady) {
        break
    }
}

$exactPathMatch = $actualPath -and [string]::Equals(
    $target.FullName,
    $actualPath,
    [System.StringComparison]::OrdinalIgnoreCase
)
if (-not $exactPathMatch) {
    throw "실행된 프로세스가 최신 로컬 빌드 경로와 다릅니다. 대상: $($target.FullName), 실제: $actualPath"
}
if (-not $windowReady) {
    throw "최신 로컬 빌드 프로세스는 실행됐지만 5초 안에 창이 준비되지 않았습니다. 프로세스 ID: $($launched.Id)"
}

[pscustomobject]@{
    status = $launchStatus
    processId = $launched.Id
    targetPath = $target.FullName
    actualPath = $actualPath
    exactPathMatch = [bool]$exactPathMatch
    windowReady = $windowReady
    processStartTime = $launched.StartTime.ToString('o')
    buildLastWriteTime = $target.LastWriteTime.ToString('o')
} | ConvertTo-Json
