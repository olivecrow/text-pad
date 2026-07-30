$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$keyDirectory = Join-Path $env:USERPROFILE '.tauri'
$keyPath = Join-Path $keyDirectory 'text-pad-updater.key'
$passwordPath = Join-Path $keyDirectory 'text-pad-updater.password.dpapi'

if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "Updater signing key not found: $keyPath"
}
if (-not (Test-Path -LiteralPath $passwordPath)) {
    throw "Updater signing password not found: $passwordPath"
}

$securePassword = Get-Content -LiteralPath $passwordPath -Raw | ConvertTo-SecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $keyPath -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $plainPassword

    Push-Location $projectRoot
    try {
        & npm run tauri build
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri build failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}
