# Prompt para Agente Frontend: Sistema de Buffer de Webhooks

## 🎯 Contexto

Se ha implementado en el backend un sistema de buffer de webhooks que resuelve el problema de webhooks de pagos llegando antes de que se cree la orden. El backend ya está completo y funcional.

## ✅ Lo que ya está hecho (Backend)

1. **Endpoints disponibles:**
   - `GET /store/cart/{cart_id}/order` - Consulta si existe orden para un carrito
   - `GET /store/payment-status/{cart_id}` - Consulta resultado de pago pendiente en buffer

2. **Funcionalidad automática:**
   - Los webhooks guardan resultados en buffer si no existe orden
   - Cuando se crea una orden, el backend automáticamente captura el pago si hay resultado en buffer
   - Los errores de pago se guardan en `cart.metadata.payment_error`

## 📋 Tu Tarea

Implementar en el frontend la lógica para:
1. Consultar si existe orden antes de crear una nueva
2. Consultar el buffer de resultados de pago
3. Hacer polling corto si no hay resultado aún
4. Mostrar errores de pago previos en el checkout
5. Agregar polling en la página de confirmación de orden

## 📖 Documentación Completa

Lee el archivo `docs/IMPLEMENTACION_FRONTEND.md` que contiene:
- Resumen detallado de lo implementado en backend
- Paso a paso completo con código de ejemplo
- Flujos de usuario documentados
- Checklist de implementación
- Notas importantes y mejores prácticas

## 🔗 Endpoints a Usar

**Base URL:** `process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL`
**Header requerido:** `x-publishable-api-key: ${NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY}`

1. `GET /store/cart/{cart_id}/order`
2. `GET /store/payment-status/{cart_id}`

## 🚀 Empezar

1. Lee `docs/IMPLEMENTACION_FRONTEND.md` completamente
2. Implementa en este orden:
   - PASO 1 y 2: Funciones de consulta
   - PASO 4 y 5: Detección y display de errores
   - PASO 3: Flujo principal `handlePaymentReturn()`
   - PASO 6: Polling en página de confirmación

## ❓ Si tienes dudas

- Revisa `docs/SOLUCION_WEBHOOK_CHECKOUT.md` para entender el problema original
- Revisa `docs/PLAN_IMPLEMENTACION_WEBHOOK_BUFFER.md` para ver la arquitectura completa
- Los endpoints están documentados en `docs/IMPLEMENTACION_FRONTEND.md`

---

**Archivo principal:** `docs/IMPLEMENTACION_FRONTEND.md`
**Fecha:** 2025-01-12


