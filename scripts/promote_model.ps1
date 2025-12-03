<#
.SYNOPSIS
  Promote a trained model file to the production models folder (Windows PowerShell).

.DESCRIPTION
  Copies a model joblib into the production folder, optionally backs up any existing
  production file with the same name, and writes/updates production/current_model.txt
  with the filename (so your ml_service picks it up).

USAGE (from repository root, PowerShell):
  .\scripts\promote_model.ps1 -Source .\backend\ml\models\model_full_pipeline_noshow_v1.joblib

PARAMETERS
  -Source   Path to the model joblib or packaged joblib.
  -DestDir  Destination models folder (default: ./backend/ml/models/production)
  -Backup   If present, backs up any overwritten file into ./backend/ml/models/backups with timestamp.
#>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Source,

    [Parameter(Mandatory=$false)]
    [string]$DestDir = ".\backend\ml\models\production",

    [switch]$Backup
)

try {
    $repoRoot = (Get-Location).Path
    $sourcePath = Resolve-Path -Path $Source -ErrorAction Stop
} catch {
    Write-Error "Source file not found: $Source"
    exit 2
}

# Normalize paths
$destDirFull = Resolve-Path -Path $DestDir -ErrorAction SilentlyContinue
if (-not $destDirFull) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    $destDirFull = Resolve-Path -Path $DestDir
}
$destDirFull = $destDirFull.Path

# backup dir
$backupDir = Join-Path (Split-Path $destDirFull -Parent) "backups"
if ($Backup -and -not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$srcFileName = Split-Path $sourcePath -Leaf
$destFile = Join-Path $destDirFull $srcFileName
$currentPtr = Join-Path $destDirFull "current_model.txt"

Write-Host "Promoting model:" -ForegroundColor Green
Write-Host "  Source: $($sourcePath)" 
Write-Host "  Destination folder: $destDirFull"
Write-Host "  Destination file: $destFile"

# If destination exists and user asked for backup, move it first
if (Test-Path $destFile) {
    if ($Backup) {
        $timeStamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
        $bakName = "$($srcFileName).bak.$timeStamp"
        $bakPath = Join-Path $backupDir $bakName
        Write-Host "Backing up existing production file to $bakPath"
        Move-Item -Path $destFile -Destination $bakPath -Force
    } else {
        Write-Host "Overwriting existing production file (no backup requested)."
        Remove-Item -Path $destFile -Force
    }
}

# Copy the source into production
Copy-Item -Path $sourcePath -Destination $destFile -Force
if (-not (Test-Path $destFile)) {
    Write-Error "Failed to copy model to production folder."
    exit 3
}

# Write current_model.txt (filename only) so ml_service can pick it up
try {
    Set-Content -Path $currentPtr -Value $srcFileName -Encoding UTF8
    Write-Host "Updated production pointer: $currentPtr -> $srcFileName"
} catch {
    Write-Warning "Failed to write current_model.txt: $_"
}

Write-Host "Promotion complete." -ForegroundColor Green
exit 0
