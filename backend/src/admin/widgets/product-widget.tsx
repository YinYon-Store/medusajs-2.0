"use client"

import React from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useState, useEffect } from "react"

const CARRIERS = [
  { label: "COORDINADORA", value: "COORDINADORA" },
  { label: "INTERRAPIDÍSIMO", value: "INTERRAPIDISIMO" },
  { label: "SERVIENTREGA", value: "SERVIENTREGA" },
  { label: "MANUAL", value: "MANUAL" },
]

const LocalFulfillmentWidget = ({ data: order }: any) => {
  // Determinar si el widget debe estar bloqueado basado en la versión de la orden
  const isVersionBlocked = (order?.version ?? 0) < 3
  const [isLocked, setIsLocked] = useState(true) // Siempre inicia bloqueado
  const [carrier, setCarrier] = useState(order?.metadata?.carrier_name ?? "")
  const [toast, setToast] = useState<{type: 'success' | 'error', message: string} | null>(null)
  
  // Obtener tracking number de fulfillments o metadata
  const getInitialTracking = () => {
    if (order?.fulfillments?.[0]?.labels?.[0]?.tracking_number) {
      return order.fulfillments[0].labels[0].tracking_number
    }
    return order?.metadata?.tracking_number ?? ""
  }
  
  const [tracking, setTracking] = useState(getInitialTracking())
  const [isSaving, setIsSaving] = useState(false)
  const [isNotifying, setIsNotifying] = useState(false)

  // Verificar si falta tracking number
  const isTrackingMissing = !tracking || tracking.trim() === ""

  // Función para mostrar notificaciones
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => {
      setToast(null)
    }, 4000)
  }

  // Función para actualizar el tracking number en la UI sin recargar la página
  const updateTrackingInUI = (newTrackingNumber: string) => {
    
    // 1. Buscar en elementos con selectores específicos de Medusa
    const specificSelectors = [
      '[data-testid="tracking-number"]',
      '[data-testid="fulfillment-tracking"]',
      '.tracking-number',
      '.fulfillment-tracking',
      '[class*="tracking"]',
      '[class*="Tracking"]'
    ]

    specificSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector)
      elements.forEach(element => {
        if (!element.closest('[data-testid="manual-shipping-widget"]')) {
          element.textContent = newTrackingNumber
          if (element instanceof HTMLInputElement) {
            element.value = newTrackingNumber
          }
        }
      })
    })

    // 2. Buscar en la sección de Tracking (basado en la imagen que viste)
    const trackingSections = document.querySelectorAll('h3, h2, h1')
    trackingSections.forEach(section => {
      if (section.textContent?.toLowerCase().includes('tracking')) {
        const parent = section.parentElement
        if (parent) {
          // Buscar números en el mismo contenedor
          const numbers = parent.querySelectorAll('span, div, p')
          numbers.forEach(element => {
            const text = element.textContent || ''
            if (/\d{6,}/.test(text) && !element.closest('[data-testid="manual-shipping-widget"]')) {
              element.textContent = newTrackingNumber
            }
          })
        }
      }
    })

    // 3. Buscar por patrones de números largos (tracking numbers típicos)
    const allTextElements = document.querySelectorAll('span, div, p, td, th')
    allTextElements.forEach(element => {
      const text = element.textContent || ''
      
      // Patrón para números de 6+ dígitos (tracking numbers típicos)
      const trackingPattern = /\b\d{6,}\b/g
      const matches = text.match(trackingPattern)
      
      if (matches && !element.closest('[data-testid="manual-shipping-widget"]')) {
        matches.forEach(match => {
          // Solo actualizar si parece un tracking number (no fechas, precios, etc.)
          if (match.length >= 6 && !match.includes('/') && !match.includes('$') && !match.includes('.')) {
            element.textContent = element.textContent?.replace(match, newTrackingNumber) || ''
          }
        })
      }
    })

    // 4. Buscar en elementos de tabla (si el tracking está en una tabla)
    const tableCells = document.querySelectorAll('td, th')
    tableCells.forEach(cell => {
      const text = cell.textContent || ''
      if (/\d{6,}/.test(text) && !cell.closest('[data-testid="manual-shipping-widget"]')) {
        cell.textContent = text.replace(/\b\d{6,}\b/g, newTrackingNumber)
      }
    })

  }

  const toggleLock = () => {
    // Solo permite desbloquear si la versión es >= 3
    if (!isVersionBlocked) {
      setIsLocked((prev) => !prev)
    }
  }

  // Generar tracking automáticamente cuando el carrier sea "MANUAL"
  useEffect(() => {
    if (carrier === "MANUAL") {
      const date = new Date()
      const day = String(date.getDate()).padStart(2, "0")
      const month = String(date.getMonth() + 1).padStart(2, "0")
      const year = String(date.getFullYear()).slice(2)
      const autoTracking = `${day}/${month}/${year}-${order.display_id}`
      setTracking(autoTracking)
    }
  }, [carrier, order.display_id])

  // El widget siempre inicia bloqueado, independientemente de la versión
  // El usuario debe desbloquearlo manualmente si la versión es >= 3

  const handleSave = async () => {
    if (!carrier || (!tracking && carrier !== "MANUAL")) {
      showToast('error', 'Por favor completa todos los campos requeridos')
      return
    }

    setIsSaving(true)
    try {
      // Actualizar metadata de la orden
      const metadataRes = await fetch(`/admin/orders/${order.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            ...order.metadata,
            carrier_name: carrier,
            tracking_number: tracking,
          },
        }),
      })

      if (!metadataRes.ok) throw new Error("Error al guardar metadata")

      // Actualizar fulfillment tracking si existe
      if (order?.fulfillments?.[0]?.id) {
        const trackingRes = await fetch(`/admin/fulfillments/${order.fulfillments[0].id}/update-tracking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tracking_number: tracking
          }),
        })

        if (!trackingRes.ok) {
          const errorData = await trackingRes.json()
          throw new Error(errorData.message || "Error al actualizar tracking")
        }
      }

      showToast('success', 'Los datos de envío se han guardado correctamente')
      setIsLocked(true)
      
      // Actualizar el tracking number en la sección de Fulfillment sin recargar la página
      updateTrackingInUI(tracking)
    } catch (err) {
      showToast('error', 'No se pudieron guardar los datos de envío')
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleNotifyShipping = async () => {
    if (!carrier || !tracking) {
      showToast('error', 'Por favor completa los datos de envío antes de notificar')
      return
    }

    setIsNotifying(true)
    try {
      const notifyRes = await fetch(`/admin/orders/${order.id}/notify-shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_name: carrier,
          tracking_number: tracking
        }),
      })

      if (!notifyRes.ok) {
        const errorData = await notifyRes.json()
        throw new Error(errorData.message || "Error al enviar notificación")
      }

      const result = await notifyRes.json()
      showToast('success', 'Notificación de envío enviada correctamente')
    } catch (err) {
      showToast('error', 'No se pudo enviar la notificación de envío')
      console.error(err)
    } finally {
      setIsNotifying(false)
    }
  }

  return (
    <div className="p-4 bg-ui-bg-subtle rounded-xl border border-ui-border-base mt-4" data-testid="manual-shipping-widget">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-semibold text-ui-fg-base">
          Datos de envío manual
        </h3>

        {!isVersionBlocked && (
          <button
            className={`px-3 py-1 text-sm rounded bg-white text-black text-bold rounded-md border border-gray-300 hover:bg-gray-300 ${isSaving || isNotifying ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={toggleLock}
            disabled={isSaving || isNotifying}
          >
            {isLocked ? "Desbloquear" : "Bloquear"}
          </button>
        )}
      </div>

      {isVersionBlocked && (
        <div className="mb-4 p-3 bg-ui-bg-warning-subtle border border-ui-border-warning rounded-lg">
          <p className="text-sm text-ui-fg-warning">
            ⚠️ Esta orden debe estar en versión 3 o superior para editar los datos de envío
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Select del carrier */}
        <div>
          <label className="block text-sm font-medium text-ui-fg-subtle mb-1">
            Transportadora
          </label>
          <select
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            disabled={isLocked}
            className="w-full px-3 py-2 border rounded-md disabled:opacity-50"
          >
            <option value="">Seleccionar carrier</option>
            {CARRIERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Campo de tracking */}
        <div>
          <label className="block text-sm font-medium text-ui-fg-subtle mb-1">
            Número de guía / Tracking
          </label>
          <input
            type="text"
            placeholder="Ej: ABC123XYZ"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            disabled={isLocked || carrier === "MANUAL"}
            className={`w-full px-3 py-2 border rounded-md disabled:opacity-50 ${
              isTrackingMissing ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500" : ""
            }`}
            title="Necesario para notificar el envío"
          />
          {isTrackingMissing && (
            <p className="text-xs text-red-500 mt-1">
              ⚠️ Este campo es requerido para notificar el envío
            </p>
          )}
        </div>
      </div>

      {!isLocked && !isVersionBlocked && (
        <div className="mt-4 flex justify-end gap-2">
          <button 
            className="px-4 py-2 bg-white text-black text-bold rounded-md border border-gray-300 hover:bg-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={isSaving || isNotifying}
          >
            {isSaving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      )}
      
  
      {/* Botón de notificación - siempre visible si hay datos */}
      {carrier && tracking && (
        <div className="mt-4 flex justify-end">
          <button 
            className="px-4 py-2 bg-white text-black text-bold rounded-md border border-gray-300 text-sm hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleNotifyShipping}
            disabled={isNotifying || isSaving}
          >
            {isNotifying ? "Enviando..." : "Notificar a WhatsApp"}
          </button>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 p-4 rounded-md shadow-lg ${
          toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-red-100 text-red-800 border border-red-300'
        }`}>
          <div className="flex justify-between items-center gap-4">
            <div>
              <strong>{toast.type === 'success' ? '✓ Éxito' : '✗ Error'}</strong>
              <p className="text-sm">{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} className="text-lg">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after", // aparece debajo del detalle del pedido
})

export default LocalFulfillmentWidget