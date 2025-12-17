# Documentación del Backend

## 📚 Índice de Documentación

Esta carpeta contiene la documentación técnica del proyecto, organizada por sistema.

---

## 🎯 Documentos Principales

### 1. Sistema de Buffer de Webhooks

#### [WEBHOOK_BUFFER_SYSTEM.md](./WEBHOOK_BUFFER_SYSTEM.md)
Documento principal del sistema de buffer de webhooks. Incluye:
- Problema y solución
- Arquitectura del sistema
- Estado de implementación (backend 95% completado)
- Especificación técnica
- Endpoints backend
- Flujos detallados

#### [WEBHOOK_BUFFER_FRONTEND.md](./WEBHOOK_BUFFER_FRONTEND.md)
Guía paso a paso para implementar el frontend del sistema de buffer. Incluye:
- Funciones de consulta necesarias
- Modificaciones al componente de checkout
- Polling en página de confirmación
- Manejo de errores de pago

#### [WEBHOOK_BUFFER_TESTING.md](./WEBHOOK_BUFFER_TESTING.md)
Guía completa de pruebas del sistema de buffer. Incluye:
- Inicio rápido
- Pruebas rápidas
- Escenarios de prueba completos
- Scripts de prueba
- Troubleshooting

---

### 2. Sistema de Búsqueda Seguro

#### [SEARCH_SECURITY.md](./SEARCH_SECURITY.md)
Documentación completa del sistema de búsqueda seguro con Meilisearch. Incluye:
- Problema y solución
- Arquitectura (flujo seguro vs inseguro)
- Implementación backend
- Implementación frontend (múltiples opciones)
- API endpoints
- Ejemplos y pruebas

---

### 3. Sistema de Notificaciones

#### [NOTIFICATIONS.md](./NOTIFICATIONS.md)
Documentación completa del sistema de notificaciones WhatsApp. Incluye:
- Estrategia de notificaciones
- Flujos y escenarios
- API del servicio de notificaciones
- Templates y parámetros
- Implementación en backend

---

## 📋 Resumen por Sistema

### Sistema de Buffer de Webhooks

**Estado:** ✅ Backend 95% completado, Frontend pendiente

**Documentos:**
- `WEBHOOK_BUFFER_SYSTEM.md` - Documentación principal
- `WEBHOOK_BUFFER_FRONTEND.md` - Guía de frontend
- `WEBHOOK_BUFFER_TESTING.md` - Guía de pruebas

**Objetivo:** Aprovechar el primer callback de las pasarelas de pago para mejorar la experiencia del usuario y reducir latencia en la confirmación de pagos.

---

### Sistema de Búsqueda Seguro

**Estado:** ✅ Implementado

**Documentos:**
- `SEARCH_SECURITY.md` - Documentación completa

**Objetivo:** Proteger las credenciales de Meilisearch manteniéndolas en el servidor, agregando validación y rate limiting.

---

### Sistema de Notificaciones

**Estado:** ✅ Implementado (con mejoras pendientes)

**Documentos:**
- `NOTIFICATIONS.md` - Documentación completa

**Objetivo:** Enviar notificaciones WhatsApp para eventos importantes (órdenes creadas, pagos capturados, envíos, etc.).

---

## 🚀 Inicio Rápido

### Para desarrolladores nuevos:

1. **Empieza aquí:** Lee `WEBHOOK_BUFFER_SYSTEM.md` para entender el sistema principal
2. **Si trabajas en frontend:** Consulta `WEBHOOK_BUFFER_FRONTEND.md`
3. **Para probar:** Usa `WEBHOOK_BUFFER_TESTING.md`

### Para entender un sistema específico:

- **Búsqueda:** `SEARCH_SECURITY.md`
- **Notificaciones:** `NOTIFICATIONS.md`
- **Pruebas:** `WEBHOOK_BUFFER_TESTING.md`

---

## 📝 Convenciones

- Todos los documentos usan Markdown
- Los ejemplos de código están en TypeScript/JavaScript
- Los endpoints están documentados con ejemplos de request/response
- Los estados de implementación se actualizan regularmente

---

## 🔄 Mantenimiento

Esta documentación se actualiza cuando:
- Se completan nuevas funcionalidades
- Se cambian APIs o endpoints
- Se identifican mejoras o correcciones

**Última actualización general:** 2025-01-12

---

## ❓ ¿Necesitas ayuda?

Si necesitas información que no está documentada:
1. Revisa el código fuente en `src/`
2. Consulta los logs del sistema
3. Contacta al equipo de desarrollo

