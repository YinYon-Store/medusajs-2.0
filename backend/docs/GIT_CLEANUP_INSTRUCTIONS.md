# Instrucciones para Limpiar Credenciales del Historial de Git

## ⚠️ IMPORTANTE: Rotar Credenciales Primero

**ANTES de hacer cualquier cosa**, debes rotar las credenciales en Firebase porque ya están comprometidas:

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Project Settings > Service Accounts
3. Elimina o desactiva la cuenta de servicio que generaste (formato: `firebase-adminsdk-xxxxx@tu-project-id.iam.gserviceaccount.com`)
4. Genera nuevas credenciales
5. Actualiza Railway y local con las nuevas credenciales

## Opciones para Limpiar el Historial

### Opción 1: Usar git filter-repo (Recomendado)

```bash
# Instalar git-filter-repo (si no lo tienes)
# Windows: pip install git-filter-repo
# Mac: brew install git-filter-repo

# Eliminar las credenciales del historial
git filter-repo --path docs/RAILWAY_FIREBASE_SETUP.md --invert-paths --force

# O reemplazar el contenido del archivo en todos los commits
# Ejemplo de reemplazo (ajusta el patrón según tus credenciales)
git filter-repo --path docs/RAILWAY_FIREBASE_SETUP.md --replace-text <(echo 'PRIVATE_KEY_ID_REAL==>xxxxx')
```

### Opción 2: Rebase Interactivo (Más Simple)

```bash
# 1. Iniciar rebase interactivo desde antes del commit problemático
git rebase -i 7650299

# 2. En el editor, cambia "pick" a "edit" para el commit 340a2fd
# 3. Git se detendrá en ese commit
# 4. El archivo ya está corregido, solo haz:
git add docs/RAILWAY_FIREBASE_SETUP.md
git commit --amend --no-edit
git rebase --continue

# 5. Force push
git push --force-with-lease
```

### Opción 3: Permitir el Push Temporalmente (NO Recomendado)

Solo si ya rotaste las credenciales:

1. Ve al enlace que GitHub proporcionó:
   ```
   https://github.com/YinYon-Store/medusajs-2.0/security/secret-scanning/unblock-secret/370L73rTle5ZyFNyWbzOxor26jI
   ```
2. Haz clic en "Allow secret"
3. Haz push normalmente

**⚠️ Esto NO elimina las credenciales del historial, solo permite el push.**

## Recomendación

**Usa la Opción 2 (Rebase Interactivo)** porque:
- Es más simple
- No requiere herramientas adicionales
- Limpia el historial correctamente
- El archivo ya está corregido en tu working directory

## Después de Limpiar

1. Verifica que no haya más credenciales:
   ```bash
   git log --all --full-history -- docs/RAILWAY_FIREBASE_SETUP.md | grep -i "private_key"
   ```

2. Haz push:
   ```bash
   git push --force-with-lease
   ```

3. Notifica a tu equipo si trabajas en grupo (por el force push)

