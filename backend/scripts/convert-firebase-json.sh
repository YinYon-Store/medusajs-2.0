#!/bin/bash
# Script para convertir el archivo JSON de Firebase a una sola línea
# Uso: ./scripts/convert-firebase-json.sh

JSON_PATH="config/firebase-service-account.json"

if [ ! -f "$JSON_PATH" ]; then
    echo "❌ Archivo no encontrado: $JSON_PATH"
    echo "   Asegúrate de tener el archivo JSON en config/firebase-service-account.json"
    exit 1
fi

echo "📄 Leyendo archivo: $JSON_PATH"

# Verificar que jq esté instalado
if ! command -v jq &> /dev/null; then
    echo "⚠️  jq no está instalado. Instalando método alternativo..."
    # Método alternativo usando node si está disponible
    if command -v node &> /dev/null; then
        MINIFIED=$(node -e "console.log(JSON.stringify(require('./$JSON_PATH')))")
    else
        echo "❌ Necesitas instalar jq o node para usar este script"
        echo "   Instala jq: brew install jq (macOS) o apt-get install jq (Linux)"
        exit 1
    fi
else
    MINIFIED=$(jq -c . "$JSON_PATH")
fi

echo ""
echo "✅ JSON convertido a una sola línea:"
echo ""
echo "FIREBASE_SERVICE_ACCOUNT_JSON=$MINIFIED"
echo ""
echo "📋 Copia la línea de arriba y agrégala a tu archivo .env"
echo "   O cópiala directamente en Railway como variable de entorno"
echo ""

# Guardar en un archivo temporal
OUTPUT_FILE="config/firebase-json-oneline.txt"
echo "FIREBASE_SERVICE_ACCOUNT_JSON=$MINIFIED" > "$OUTPUT_FILE"
echo "💾 También guardado en: $OUTPUT_FILE"



