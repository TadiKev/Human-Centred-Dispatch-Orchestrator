param(
  [Parameter(Mandatory=$true)][string]$ModelFileName,
  [string]$ModelsDir = "backend/ml/models"
)

# normalize slashes & paths
$ModelsDir = $ModelsDir.TrimEnd('\','/').Replace('/','\')
$prodDir = Join-Path $ModelsDir "production"
$currentPtr = Join-Path $prodDir "current_model.txt"

if (-not (Test-Path $ModelsDir)) {
  Write-Error "Models directory not found: $ModelsDir"
  exit 1
}

if (-not (Test-Path $prodDir)) {
  New-Item -ItemType Directory -Path $prodDir | Out-Null
}

$src = Join-Path $ModelsDir $ModelFileName
if (-not (Test-Path $src)) {
  Write-Error "Model file not found: $src"
  exit 1
}

# copy model into production directory
Copy-Item -Path $src -Destination $prodDir -Force

# write pointer file
Set-Content -Path $currentPtr -Value $ModelFileName -Force
Write-Host "Promoted $ModelFileName -> $prodDir"
