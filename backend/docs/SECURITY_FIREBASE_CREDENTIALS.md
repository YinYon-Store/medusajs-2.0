# ⚠️ IMPORTANTE: Credenciales Expuestas en Git

## Problema Detectado

GitHub detectó credenciales reales de Firebase en el historial de Git (commit `340a2fd57b287807078ae30eff543777f116bf3a`).

## 🔒 Acciones Requeridas INMEDIATAS

### 1. Rotar las Credenciales de Firebase

**⚠️ CRÍTICO**: Las credenciales expuestas están comprometidas. Debes rotarlas inmediatamente.

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Project Settings > Service Accounts
3. Encuentra la cuenta de servicio que generaste (formato: `firebase-adminsdk-xxxxx@aura-logs.iam.gserviceaccount.com`)
4. **Elimina la clave antigua** o **desactiva la cuenta de servicio**
5. Genera una **nueva clave privada**
6. Actualiza las variables de entorno en Railway y local con las nuevas credenciales

### 2. Limpiar el Historial de Git

Tienes dos opciones:

#### Opción A: Usar el enlace de GitHub (Recomendado)

GitHub te proporcionó un enlace para permitir el push:
```
https://github.com/YinYon-Store/medusajs-2.0/security/secret-scanning/unblock-secret/370L73rTle5ZyFNyWbzOxor26jI
```

**⚠️ NO uses esta opción** a menos que ya hayas rotado las credenciales. Es mejor limpiar el historial.

#### Opción B: Limpiar el Historial (Recomendado)

```bash
# 1. Ver el commit problemático
git log --oneline | head -5

# 2. Usar git filter-branch o BFG Repo-Cleaner para eliminar las credenciales del historial
# O simplemente hacer un nuevo commit que reemplace las credenciales

# 3. Después de limpiar, hacer force push
git push --force-with-lease
```

**Nota**: Si trabajas en equipo, coordina el force push para evitar conflictos.

### 3. Verificar que no hay más credenciales

```bash
# Buscar posibles credenciales en el código
git log --all --full-history --source -- "*.md" | grep -i "private_key\|client_email\|service_account"
```

## ✅ Prevención Futura

1. ✅ **NUNCA** subas credenciales reales a Git
2. ✅ Usa siempre valores de ejemplo en documentación
3. ✅ Usa `.gitignore` para archivos con credenciales
4. ✅ Usa variables de entorno para credenciales
5. ✅ Revisa los cambios antes de hacer commit

## 📝 Estado Actual

- ✅ Credenciales reemplazadas en `docs/RAILWAY_FIREBASE_SETUP.md`
- ⚠️ Credenciales aún en historial de Git (commit anterior)
- ⚠️ **DEBES rotar las credenciales en Firebase**

