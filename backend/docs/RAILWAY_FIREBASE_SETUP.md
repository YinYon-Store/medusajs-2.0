# Configurar Firebase en Railway

## 🚀 Configuración en Railway

Railway no permite subir archivos directamente, por lo que debes usar **variables de entorno** para las credenciales de Firebase.

## 📋 Pasos para Configurar

### 1. Obtener el JSON de Service Account

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Selecciona tu proyecto (ej: **aura-logs**)
3. Ve a **Project Settings** (⚙️) > **Service Accounts**
4. Haz clic en **Generate New Private Key**
5. Se descargará un archivo JSON
6. **Abre el archivo JSON** y copia todo su contenido

### 2. Configurar Variables de Entorno en Railway

### Configuración (Recomendado)

1. Ve a tu proyecto en [Railway](https://railway.app/)
2. Selecciona tu servicio (backend)
3. Ve a la pestaña **Variables**
4. Agrega las siguientes variables:

```bash
# Habilitar Firebase
FIREBASE_ENABLED=true

# JSON completo del service account (una sola línea)
# ⚠️ Reemplaza con tus credenciales reales (usa el script convert-firebase-json.ps1)
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"tu-project-id","private_key_id":"xxxxx","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxxxx@tu-project-id.iam.gserviceaccount.com",...}
```

**⚠️ Importante**: 
- El JSON debe estar en **una sola línea** (sin saltos de línea)
- Puedes usar un formatter online para convertir el JSON a una línea
- O escapar los saltos de línea manualmente
- **Usa la misma variable en local y producción** para mantener consistencia

### 3. Convertir JSON a Una Línea

#### Opción 1: Script Automático (Recomendado)

**Windows (PowerShell):**
```powershell
.\scripts\convert-firebase-json.ps1
```

**Linux/Mac (Bash):**
```bash
chmod +x scripts/convert-firebase-json.sh
./scripts/convert-firebase-json.sh
```

El script generará la línea completa lista para copiar.

#### Opción 2: Online
- Ve a [JSON Minifier](https://jsonformatter.org/json-minify)
- Pega tu JSON
- Copia el resultado (una sola línea)
- Agrégale el prefijo: `FIREBASE_SERVICE_ACCOUNT_JSON=`

#### Opción 3: Manual (PowerShell)
```powershell
$json = Get-Content "config\firebase-service-account.json" -Raw
$minified = ($json | ConvertFrom-Json | ConvertTo-Json -Compress)
Write-Host "FIREBASE_SERVICE_ACCOUNT_JSON=$minified"
```

### 4. Verificar Configuración

Después de agregar las variables en Railway:

1. **Redeploy** tu servicio (Railway detectará los cambios automáticamente)
2. Ve a los **Logs** de Railway
3. Deberías ver:
   ```
   ✅ Firebase inicializado correctamente (Project: tu-project-id)
   ```

Si ves un error, verifica:
- Que el JSON sea válido (una sola línea)
- Que no haya espacios extra al inicio/final
- Que las comillas estén escapadas correctamente

## 🔒 Seguridad

### ✅ Buenas Prácticas

- ✅ **NO** subas el archivo JSON a Git
- ✅ **NO** lo incluyas en el código
- ✅ Usa **Railway Secrets** (variables de entorno) para credenciales
- ✅ Rota las credenciales periódicamente
- ✅ Usa diferentes credenciales para staging/producción

### ❌ Qué NO Hacer

- ❌ No subas `firebase-service-account.json` al repositorio
- ❌ No hardcodees credenciales en el código
- ❌ No compartas las credenciales en chats/documentos públicos
- ❌ No uses las mismas credenciales en desarrollo y producción

## 📝 Ejemplo Completo en Railway

### Variables de Entorno en Railway

**⚠️ IMPORTANTE**: Reemplaza los valores de ejemplo con tus credenciales reales.

```
FIREBASE_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"tu-project-id","private_key_id":"xxxxx","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxxxx@tu-project-id.iam.gserviceaccount.com","client_id":"xxxxx","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40tu-project-id.iam.gserviceaccount.com","universe_domain":"googleapis.com"}
```

**Nota**: Este es solo un ejemplo. Usa el script `.\scripts\convert-firebase-json.ps1` para generar tu JSON real.

### Verificación en Logs

Después del deploy, en los logs de Railway deberías ver:

```
✅ Firebase inicializado correctamente (Project: aura-logs)
```

Si ves errores, revisa:
- Formato del JSON (debe ser válido)
- Que no haya caracteres especiales sin escapar
- Que las comillas estén correctas

## 🔄 Diferentes Ambientes

### Staging vs Producción

Puedes usar diferentes proyectos de Firebase para cada ambiente:

**Staging:**
```
FIREBASE_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"tu-project-id-staging",...}
```

**Producción:**
```
FIREBASE_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"tu-project-id",...}
```

## 🐛 Troubleshooting

### Error: "Firebase no configurado correctamente"

**Causa**: El JSON no es válido o está mal formateado.

**Solución**:
1. Verifica que el JSON sea válido usando un validador JSON
2. Asegúrate de que esté en una sola línea
3. Verifica que no haya espacios extra al inicio/final

### Error: "Cannot parse JSON"

**Causa**: El JSON tiene caracteres especiales sin escapar.

**Solución**:
1. Usa un minifier JSON online
2. O escapa manualmente las comillas y saltos de línea

### Error: "Permission denied"

**Causa**: La cuenta de servicio no tiene permisos.

**Solución**:
1. Verifica en [Google Cloud Console](https://console.cloud.google.com/iam-admin/iam)
2. Asegúrate de que la cuenta tenga rol: **Firebase Admin SDK Administrator Service Agent**

## 📚 Referencias

- [Railway Environment Variables](https://docs.railway.app/develop/variables)
- [Firebase Admin SDK Setup](https://firebase.google.com/docs/admin/setup)
- [JSON Minifier](https://jsonformatter.org/json-minify)

