param([switch]$RefreshOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'src-tauri\target\release\text-pad.exe'
$destination = Join-Path $projectRoot 'src-tauri\target\release\text-pad-dev.exe'
$appKey = 'Software\Classes\Applications\text-pad-dev.exe'
$appName = 'text-pad (개발용)'

# 일반 빌드는 등록을 생성하지 않는다. 명시적으로 등록한 개발 사본만 갱신한다.
if ($RefreshOnly -and -not (Test-Path -LiteralPath $destination)) { return }
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw '먼저 npm run tauri:build:signed 명령으로 빌드하세요.'
}
if (-not (Test-Path -LiteralPath $destination) -or
    (Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
if ($RefreshOnly) { return }

function Set-UserRegistryString([string]$Path, [string]$Name, [string]$Value) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path)
    try { $key.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose() }
}

$command = '"' + $destination + '" "%1"'
$icon = '"' + $destination + '",0'
$extensions = (Get-Content (Join-Path $projectRoot 'supported-text-formats.json') -Raw |
    ConvertFrom-Json).formats.extensions | Sort-Object -Unique
Set-UserRegistryString $appKey 'FriendlyAppName' $appName
Set-UserRegistryString "$appKey\shell\open\command" '' $command
Set-UserRegistryString "$appKey\DefaultIcon" '' $icon
# 앱 선택창은 경로별 표시 이름 캐시도 사용한다. 설치 경로의 캐시는 바꾸지 않는다.
$nameCache = 'Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
foreach ($developmentPath in @($source, $destination)) {
    Set-UserRegistryString $nameCache "$developmentPath.FriendlyAppName" $appName
    Set-UserRegistryString $nameCache "$developmentPath.ApplicationCompany" 'text-pad'
}
$capabilities = 'Software\text-pad-development\Capabilities'
Set-UserRegistryString $capabilities 'ApplicationName' $appName
Set-UserRegistryString $capabilities 'ApplicationDescription' '현재 저장소에서 빌드한 text-pad'
Set-UserRegistryString $capabilities 'ApplicationIcon' $icon
Set-UserRegistryString 'Software\RegisteredApplications' $appName $capabilities
foreach ($extension in $extensions) {
    $progId = "text-pad-development.$extension"
    Set-UserRegistryString "$appKey\SupportedTypes" ".$extension" ''
    Set-UserRegistryString "$capabilities\FileAssociations" ".$extension" $progId
    Set-UserRegistryString "Software\Classes\.$extension\OpenWithProgids" $progId ''
    Set-UserRegistryString "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$extension\OpenWithProgids" $progId ''
    Set-UserRegistryString "Software\Classes\$progId" '' "text-pad 개발용 $extension 문서"
    Set-UserRegistryString "Software\Classes\$progId\Application" 'ApplicationName' $appName
    Set-UserRegistryString "Software\Classes\$progId\Application" 'ApplicationIcon' $icon
    Set-UserRegistryString "Software\Classes\$progId\DefaultIcon" '' $icon
    Set-UserRegistryString "Software\Classes\$progId\shell\open\command" '' $command
}

# 설치본과 같은 이름으로 수동 등록했던 항목은 이 저장소를 가리킬 때만 이전한다.
$oldKeyPath = 'Software\Classes\Applications\text-pad.exe'
$oldCommandKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$oldKeyPath\shell\open\command")
if ($null -ne $oldCommandKey) {
    try { $oldCommand = $oldCommandKey.GetValue('') } finally { $oldCommandKey.Dispose() }
    if ($oldCommand -eq ('"' + $source + '" "%1"')) {
        $backup = Join-Path $projectRoot 'src-tauri\target\release\development-open-with-backup.reg'
        if (-not (Test-Path -LiteralPath $backup)) {
            & reg.exe export "HKCU\$oldKeyPath" $backup /y | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '기존 개발용 등록 백업에 실패했습니다.' }
        }
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($oldKeyPath)
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DevelopmentFileAssociationNotification {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
[DevelopmentFileAssociationNotification]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
[pscustomobject]@{ Name = $appName; Executable = $destination; Extensions = $extensions.Count } | ConvertTo-Json
