# Script de création de release pour Nowtify
# Crée automatiquement un fichier .rar avec les fichiers nécessaires pour Chrome Web Store

$releaseDir = "release"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$version = "1.0.0"

try {
    $manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
    $version = $manifest.version
} catch {
    Write-Host "Impossible de lire la version depuis manifest.json, utilisation de la version par défaut" -ForegroundColor Yellow
}

$releaseFileName = "nowtify-v$version.rar"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Création de release Nowtify v$version" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $releaseDir) {
    Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

$filesToInclude = @(
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "options.html",
    "options.css",
    "options.js",
    "icons"
)

Write-Host "Copie des fichiers..." -ForegroundColor Yellow
foreach ($file in $filesToInclude) {
    if (Test-Path $file) {
        Copy-Item $file -Destination $releaseDir -Recurse -Force
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file (non trouvé)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Création de l'archive .rar..." -ForegroundColor Yellow

$winrarPath = "C:\Program Files\WinRAR\WinRAR.exe"
$winrarPath32 = "C:\Program Files (x86)\WinRAR\WinRAR.exe"

$rarPath = $null
if (Test-Path $winrarPath) {
    $rarPath = $winrarPath
} elseif (Test-Path $winrarPath32) {
    $rarPath = $winrarPath32
} else {
    Write-Host ""
    Write-Host "WinRAR non trouvé. Tentative avec 7-Zip..." -ForegroundColor Yellow
    
    $sevenZipPath = "C:\Program Files\7-Zip\7z.exe"
    $sevenZipPath32 = "C:\Program Files (x86)\7-Zip\7z.exe"
    
    if (Test-Path $sevenZipPath) {
        & $sevenZipPath a -tzip "$releaseFileName" ".\$releaseDir\*" | Out-Null
        $releaseFileName = $releaseFileName -replace "\.rar$", ".zip"
        Write-Host "  ✓ Archive créée avec 7-Zip: $releaseFileName" -ForegroundColor Green
    } elseif (Test-Path $sevenZipPath32) {
        & $sevenZipPath32 a -tzip "$releaseFileName" ".\$releaseDir\*" | Out-Null
        $releaseFileName = $releaseFileName -replace "\.rar$", ".zip"
        Write-Host "  ✓ Archive créée avec 7-Zip: $releaseFileName" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Aucun outil d'archivage trouvé (WinRAR ou 7-Zip)" -ForegroundColor Red
        Write-Host "Création d'un .zip natif PowerShell..." -ForegroundColor Yellow
        $zipFileName = $releaseFileName -replace "\.rar$", ".zip"
        Compress-Archive -Path ".\$releaseDir\*" -DestinationPath $zipFileName -Force
        Write-Host "  ✓ Archive créée: $zipFileName" -ForegroundColor Green
        $releaseFileName = $zipFileName
    }
}

if ($rarPath) {
    & $rarPath a -afrar -ep1 -r "$releaseFileName" ".\$releaseDir\*" | Out-Null
    Write-Host "  ✓ Archive créée avec WinRAR: $releaseFileName" -ForegroundColor Green
}

Write-Host ""
Write-Host "Nettoyage..." -ForegroundColor Yellow
Remove-Item $releaseDir -Recurse -Force
Write-Host "  ✓ Dossier temporaire supprimé" -ForegroundColor Green

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Release créée avec succès!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Fichier: $releaseFileName" -ForegroundColor White
Write-Host "Taille: $((Get-Item $releaseFileName).Length / 1KB) KB" -ForegroundColor White
Write-Host ""
Write-Host "Ce fichier peut être uploadé sur:" -ForegroundColor Yellow
Write-Host "  • GitHub Releases" -ForegroundColor Cyan
Write-Host "  • Chrome Web Store" -ForegroundColor Cyan
Write-Host ""
