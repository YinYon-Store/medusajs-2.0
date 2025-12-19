# Script para limpiar credenciales de Firebase del historial de Git
# ⚠️ IMPORTANTE: Rota las credenciales en Firebase ANTES de ejecutar esto

Write-Host "⚠️  ADVERTENCIA: Este script modificará el historial de Git" -ForegroundColor Yellow
Write-Host "   Asegúrate de haber rotado las credenciales en Firebase primero" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "¿Continuar? (s/N)"

if ($confirm -ne "s" -and $confirm -ne "S") {
    Write-Host "Operación cancelada" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🔄 Iniciando rebase interactivo..." -ForegroundColor Cyan

# El commit problemático es 340a2fd, el anterior es 7650299
# Vamos a hacer rebase desde el commit anterior
git rebase -i 7650299

Write-Host ""
Write-Host "✅ Rebase completado" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Instrucciones:" -ForegroundColor Cyan
Write-Host "1. En el editor que se abrió, cambia 'pick' a 'edit' para el commit 340a2fd"
Write-Host "2. Guarda y cierra el editor"
Write-Host "3. Git se detendrá en ese commit"
Write-Host "4. El archivo ya está corregido, ejecuta:" -ForegroundColor Yellow
Write-Host "   git add docs/RAILWAY_FIREBASE_SETUP.md" -ForegroundColor Yellow
Write-Host "   git commit --amend --no-edit" -ForegroundColor Yellow
Write-Host "   git rebase --continue" -ForegroundColor Yellow
Write-Host ""
Write-Host "5. Después del rebase, haz push:" -ForegroundColor Yellow
Write-Host "   git push --force-with-lease" -ForegroundColor Yellow



