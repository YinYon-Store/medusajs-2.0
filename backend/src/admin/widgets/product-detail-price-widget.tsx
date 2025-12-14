"use client"

import React, { useState, useEffect } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"

/**
 * Widget que muestra el precio del producto y análisis de rentabilidad
 */
const ProductDetailPriceWidget = ({ data: product }: { data: any }) => {
  const [price, setPrice] = useState<{ amount: number; currency_code: string } | null>(null)
  const [variant, setVariant] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Valores configurables para cálculos
  const [envio, setEnvio] = useState<number>(10000) // Envío fijo por defecto $10.000 COP
  const [comisionPago, setComisionPago] = useState<number>(6.5) // Porcentaje
  const [costoTransaccion, setCostoTransaccion] = useState<number>(5000) // COP
  const [costoEmpacado, setCostoEmpacado] = useState<number>(12000) // COP
  const [precioProveedor, setPrecioProveedor] = useState<number>(0) // Para calcular si es rentable

  useEffect(() => {
    const fetchPrice = async () => {
      if (!product?.id) {
        setLoading(false)
        return
      }

      try {
        // Intentar obtener variantes del objeto primero
        let productVariant = product?.variants?.[0]

        // Si no hay variantes en el objeto, hacer llamada a la API
        if (!productVariant) {
          try {
            const response = await fetch(`/admin/products/${product.id}`, {
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
            })

            if (response.ok) {
              const productData = await response.json()
              productVariant = productData.product?.variants?.[0] || productData?.variants?.[0]

              if (productVariant) {
                setVariant(productVariant)
              }
            }
          } catch (apiError) {
            console.error("❌ Error obteniendo variantes desde API:", apiError)
          }
        } else {
          setVariant(productVariant)
        }

        if (!productVariant) {
          setLoading(false)
          return
        }

        // Intentar obtener precio desde diferentes estructuras posibles
        let foundPrice: { amount: number; currency_code: string } | null = null

        // Opción 1: Desde price_set.prices (estructura estándar en Medusa 2.0)
        if (productVariant.price_set?.prices?.length > 0) {
          const priceItem = productVariant.price_set.prices[0]
          if (priceItem && priceItem.amount != null) {
            foundPrice = {
              amount: priceItem.amount,
              currency_code: priceItem.currency_code || "USD",
            }
          }
        }
        // Opción 2: Desde price_set.money_amounts (estructura alternativa)
        else if ((productVariant.price_set as any)?.money_amounts?.length > 0) {
          const moneyAmount = (productVariant.price_set as any).money_amounts[0]
          foundPrice = {
            amount: moneyAmount.amount || 0,
            currency_code: moneyAmount.currency_code || "USD",
          }
        }
        // Opción 3: Desde prices directamente en la variante
        else if (productVariant.prices?.length > 0) {
          const priceItem = productVariant.prices[0]
          if (priceItem && priceItem.amount != null) {
            foundPrice = {
              amount: priceItem.amount,
              currency_code: priceItem.currency_code || "USD",
            }
          }
        }

        setPrice(foundPrice)
      } catch (error) {
        console.error("Error obteniendo precio del producto:", error)
        setPrice(null)
      } finally {
        setLoading(false)
      }
    }

    fetchPrice()
  }, [product])

  if (loading) {
    return (
      <div className="p-4 bg-ui-bg-subtle rounded-lg border border-ui-border-base mb-4 animate-pulse">
        <div className="h-4 bg-ui-bg-base w-32 rounded mb-2"></div>
        <div className="h-8 bg-ui-bg-base w-48 rounded"></div>
      </div>
    )
  }

  if (!price || price.amount === 0) {
    return (
      <div className="p-5 bg-orange-50 rounded-lg border border-orange-200 mb-4">
        <div className="text-orange-800 text-base font-semibold mb-4">
          ⚠️ Sin precio configurado
        </div>
        <div className="bg-white p-4 rounded-md border border-ui-border-base overflow-auto max-h-[600px]">
          <div className="text-xs font-semibold text-ui-fg-subtle mb-2 uppercase">
            JSON Completo del Producto:
          </div>
          <pre className="text-[11px] font-mono text-ui-fg-base m-0 whitespace-pre-wrap break-words">
            {JSON.stringify(product, null, 2)}
          </pre>
        </div>
      </div>
    )
  }

  // Formatear el precio
  let amount = price.amount
  if (price.currency_code === "COP" && price.amount > 1000000) {
    if (price.amount > 10000000) {
      amount = price.amount / 100
    }
  }

  const formattedAmount = amount.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  // Cálculos financieros
  const precioProducto = amount
  const totalTransaccion = precioProducto + envio // A
  const comisionesPago = (totalTransaccion * comisionPago) / 100 + costoTransaccion // B
  const costoEmpacadoDist = costoEmpacado // C
  const netoDespuesCostos = totalTransaccion - comisionesPago - costoEmpacadoDist

  // Calcular rentabilidad con precio de proveedor ingresado
  const calcularRentabilidad = () => {
    if (precioProveedor <= 0) return null
    const gananciaCalc = netoDespuesCostos - precioProveedor
    const margenCalc = (gananciaCalc / netoDespuesCostos) * 100
    return {
      ganancia: gananciaCalc,
      margen: margenCalc,
      esRentable: gananciaCalc > 0
    }
  }

  const rentabilidad = calcularRentabilidad()

  // Escenarios KPIs para la tarjeta
  const escenariosKPI = [0, 10, 30].map(margen => {
    const precioProveedorCalc = netoDespuesCostos * (1 - margen / 100)
    return {
      margen,
      precioProveedor: precioProveedorCalc,
      color: margen === 0 ? "bg-gray-100 text-gray-600" : margen === 10 ? "bg-yellow-50 text-yellow-700" : "bg-green-50 text-green-700",
      borderColor: margen === 0 ? "border-gray-200" : margen === 10 ? "border-yellow-200" : "border-green-200"
    }
  })

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Sección Izquierda: Desglose de la Transacción */}
        <div className="p-5  bg-white bg-ui-bg-subtle rounded-xl border border-ui-border-base shadow-sm h-full flex flex-col">
          <h3 className="text-xs font-semibold text-ui-fg-subtle uppercase tracking-wider mb-4">
            Resumen Financiero
          </h3>

          <div className="flex-grow space-y-4">
            {/* Total Transacción */}
            <div className="flex justify-between items-baseline border-b border-ui-border-base pb-3">
              <span className="text-sm text-ui-fg-subtle">Total Transacción</span>
              <span className="text-xl font-bold text-ui-fg-base">
                ${totalTransaccion.toLocaleString("es-CO", { maximumFractionDigits: 0 })}
              </span>
            </div>

            {/* Breakdown Lista */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center text-ui-fg-subtle">
                <span>Precio Producto</span>
                <span>${precioProducto.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-ui-fg-subtle">
                <span>Envío (Fijo)</span>
                <span>${envio.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-red-500 font-medium pt-2">
                <span>- Costos Operativos</span>
                <span>${Math.round(comisionesPago + costoEmpacadoDist).toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="pl-3 border-l-2 border-ui-border-base space-y-1 mt-1">
                <div className="flex justify-between text-xs text-ui-fg-muted">
                  <span>Comisión ({comisionPago}%) + Tx</span>
                  <span>${Math.round(comisionesPago).toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between text-xs text-ui-fg-muted">
                  <span>Empacado y Logística</span>
                  <span>${costoEmpacadoDist.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Hero Card: Neto */}
          <div className={`mt-6 p-4 rounded-lg border ${netoDespuesCostos > 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <div className="text-xs font-medium text-ui-fg-subtle mb-1 opacity-80">
              Neto después de costos
            </div>
            <div className={`text-2xl font-bold ${netoDespuesCostos > 0 ? "text-green-700" : "text-red-700"}`}>
              ${Math.round(netoDespuesCostos).toLocaleString("es-CO", { maximumFractionDigits: 0 })}
            </div>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="mt-4 w-full py-2 text-xs font-medium text-ui-fg-subtle hover:text-ui-fg-base hover:bg-ui-bg-base rounded transition-colors"
          >
            Ver desglose detallado &rarr;
          </button>
        </div>

        {/* Sección Derecha: Análisis de Rentabilidad */}
        <div className="p-5 bg-white rounded-xl border border-ui-border-base shadow-sm h-full flex flex-col">
          <h3 className="text-xs font-semibold text-ui-fg-subtle uppercase tracking-wider mb-4 flex justify-between items-center">
            Análisis de Rentabilidad
            <span className="bg-ui-bg-subtle text-[10px] px-2 py-0.5 rounded text-ui-fg-muted font-normal normal-case">Simulador</span>
          </h3>

          {/* Calculadora (Top) */}
          <div className="mb-6">
            <label className="block text-xs font-medium text-ui-fg-base mb-1.5">
              Precio de compra al Proveedor
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-ui-fg-muted">$</span>
              <input
                type="number"
                value={precioProveedor || ""}
                onChange={(e) => setPrecioProveedor(Number(e.target.value))}
                placeholder="0"
                className="w-full pl-6 pr-3 py-2 bg-ui-bg-field border border-ui-border-base rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all outline-none"
              />
            </div>

            {/* Resultado Inmediato Calculadora */}
            {rentabilidad && (
              <div className={`mt-3 p-3 rounded-lg border flex justify-between items-center ${rentabilidad.esRentable ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                }`}>
                <div>
                  <div className={`text-xs font-bold uppercase ${rentabilidad.esRentable ? "text-green-800" : "text-red-800"}`}>
                    {rentabilidad.esRentable ? "Rentable" : "No Rentable"}
                  </div>
                  <div className="text-xs text-ui-fg-subtle mt-0.5">
                    Margen: <strong>{rentabilidad.margen.toFixed(1)}%</strong>
                  </div>
                </div>
                <div className={`text-lg font-bold ${rentabilidad.esRentable ? "text-green-700" : "text-red-700"}`}>
                  ${Math.round(rentabilidad.ganancia).toLocaleString("es-CO", { maximumFractionDigits: 0 })}
                </div>
              </div>
            )}
          </div>

          {/* KPI Cards (Escenarios) */}
          <div className="flex-grow">
            <div className="text-xs font-medium text-ui-fg-muted mb-2">Escenarios de Compra Sugeridos</div>
            <div className="grid grid-cols-1 gap-2">
              {escenariosKPI.map((escenario) => (
                <div
                  key={escenario.margen}
                  className={`p-3 rounded-lg border ${escenario.borderColor} ${escenario.color} flex justify-between items-center`}
                >
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                      {escenario.margen === 0 ? "Punto de Equilibrio (0%)" : `Ganancia ${escenario.margen}%`}
                    </div>
                    <div className="text-xs mt-0.5 opacity-90">
                      Compra máx:
                    </div>
                  </div>
                  <div className="text-base font-bold">
                    ${Math.round(escenario.precioProveedor).toLocaleString("es-CO", { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal con Detalles Completos (Mantenido funcional pero estilizado) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-ui-border-base flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-ui-fg-base">Configuración y Análisis Detallado</h2>
              <button onClick={() => setShowModal(false)} className="text-ui-fg-muted hover:text-ui-fg-base text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-6">
              {/* Parámetros */}
              <div className="bg-ui-bg-subtle p-4 rounded-lg border border-ui-border-base">
                <h4 className="text-sm font-semibold text-ui-fg-base mb-3">Parámetros de Costos</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-ui-fg-subtle mb-1">Envío (COP)</label>
                    <input type="number" value={envio} onChange={(e) => setEnvio(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-ui-fg-subtle mb-1">Comisión Pago (%)</label>
                    <input type="number" value={comisionPago} onChange={(e) => setComisionPago(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-ui-fg-subtle mb-1">Costo Tx (COP)</label>
                    <input type="number" value={costoTransaccion} onChange={(e) => setCostoTransaccion(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-ui-fg-subtle mb-1">Empacado (COP)</label>
                    <input type="number" value={costoEmpacado} onChange={(e) => setCostoEmpacado(Number(e.target.value))} className="w-full px-2 py-1.5 border rounded text-sm" />
                  </div>
                </div>
              </div>

              {/* Tabla detallada de escenarios */}
              <div>
                <h4 className="text-sm font-semibold text-ui-fg-base mb-3">Tabla de Escenarios Completa</h4>
                <div className="overflow-hidden border border-ui-border-base rounded-lg">
                  <table className="min-w-full divide-y divide-ui-border-base">
                    <thead className="bg-ui-bg-subtle">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-ui-fg-subtle uppercase">Margen</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-ui-fg-subtle uppercase">Precio Proveedor</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-ui-fg-subtle uppercase">Ganancia Reg.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ui-border-base bg-white">
                      {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((margen) => {
                        const pProv = netoDespuesCostos * (1 - margen / 100)
                        const ganancia = netoDespuesCostos * (margen / 100)
                        return (
                          <tr key={margen} className="hover:bg-ui-bg-base transition-colors">
                            <td className="px-3 py-2 text-sm text-ui-fg-base font-medium">{margen}%</td>
                            <td className="px-3 py-2 text-sm text-ui-fg-subtle text-right">${Math.round(pProv).toLocaleString("es-CO")}</td>
                            <td className="px-3 py-2 text-sm text-green-600 font-medium text-right">${Math.round(ganancia).toLocaleString("es-CO")}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-ui-border-base bg-ui-bg-subtle flex justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 text-sm font-medium">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default ProductDetailPriceWidget
