# Script para convertir el archivo JSON de Firebase a una sola línea
# Uso: .\scripts\convert-firebase-json.ps1

$jsonPath = "config\firebase-service-account.json"

if (-not (Test-Path $jsonPath)) {
    Write-Host "❌ Archivo no encontrado: $jsonPath" -ForegroundColor Red
    Write-Host "   Asegúrate de tener el archivo JSON en config\firebase-service-account.json" -ForegroundColor Yellow
    exit 1
}

Write-Host "📄 Leyendo archivo: $jsonPath" -ForegroundColor Cyan

try {
    $jsonContent = Get-Content $jsonPath -Raw
    $jsonObject = $jsonContent | ConvertFrom-Json
    $minified = $jsonObject | ConvertTo-Json -Compress
    
    Write-Host ""
    Write-Host "✅ JSON convertido a una sola línea:" -ForegroundColor Green
    Write-Host ""
    Write-Host "FIREBASE_SERVICE_ACCOUNT_JSON=$minified" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📋 Copia la línea de arriba y agrégala a tu archivo .env" -ForegroundColor Cyan
    Write-Host "   O cópiala directamente en Railway como variable de entorno" -ForegroundColor Cyan
    Write-Host ""
    
    # Guardar en un archivo temporal para fácil copia
    $outputFile = "config\firebase-json-oneline.txt"
    "FIREBASE_SERVICE_ACCOUNT_JSON=$minified" | Out-File -FilePath $outputFile -Encoding utf8
    Write-Host "💾 También guardado en: $outputFile" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Error procesando JSON: $_" -ForegroundColor Red
    exit 1
}








