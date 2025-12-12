import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { IOrderModuleService, IPaymentModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { getPaymentResult, clearPaymentResult } from '../lib/payment-buffer-service'
import { notifyPaymentCaptured, notifyOrderCreated } from '../lib/notification-service'

// Log that subscriber is registered
console.log('📋 Order created payment buffer subscriber registered - listening for events: order.placed, order.created, order.completed')

/**
 * Subscriber que se ejecuta cuando se crea una orden
 * Verifica si hay un resultado de pago en el buffer y lo captura automáticamente
 */
export default async function orderCreatedPaymentBufferHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  console.log('📦 Order created payment buffer subscriber triggered - Order ID:', data?.id)
  
  try {
    const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
    const paymentModule: IPaymentModuleService = container.resolve(Modules.PAYMENT)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    if (!data?.id) {
      console.error('❌ Order created payment buffer subscriber: No order ID in event data')
      return
    }
    
    const orderId = data.id
    
    // Obtener la orden con relaciones necesarias
    let order;
    try {
      order = await orderModuleService.retrieveOrder(orderId, {
        relations: ['shipping_address', 'summary']
      })
    } catch (error) {
      console.error('❌ Order created payment buffer subscriber: Error retrieving order:', error)
      return
    }
    
    if (!order) {
      console.error('❌ Order created payment buffer subscriber: Order not found')
      return
    }
    
    console.log('✅ Order retrieved successfully - Display ID:', order.display_id)
    
    // Enviar notificación WhatsApp de orden creada (siempre se envía)
    try {
      console.log('📱 Sending WhatsApp notification for order created:', order.id)
      await notifyOrderCreated(order)
      console.log('✅ WhatsApp notification sent successfully for order created')
    } catch (error) {
      console.error('❌ Error sending WhatsApp order created notification:', error)
      // No fallar si solo falla la notificación
    }
    
    // Buscar cart_id asociado a la orden
    let cartId: string | null = null
    try {
      const { data: orderCarts } = await query.graph({
        entity: "order_cart",
        fields: ["cart_id"],
        filters: { order_id: orderId },
      })
      
      if (orderCarts && orderCarts.length > 0) {
        cartId = orderCarts[0].cart_id
        console.log(`✅ Cart ID encontrado para orden ${orderId}: ${cartId}`)
      } else {
        console.log(`ℹ️ No se encontró cart_id para orden ${orderId}, saltando verificación de buffer`)
        return
      }
    } catch (error) {
      console.error('❌ Error buscando cart_id para orden:', error)
      return
    }
    
    // Verificar si hay resultado de pago en buffer
    const paymentResult = await getPaymentResult(cartId)
    
    if (!paymentResult) {
      console.log(`ℹ️ No hay resultado de pago en buffer para cart: ${cartId}`)
      return
    }
    
    console.log(`📦 Resultado de pago encontrado en buffer para cart: ${cartId}`, {
      status: paymentResult.status,
      provider: paymentResult.provider,
      transaction_id: paymentResult.transaction_id,
    })
    
    // Solo procesar si el resultado es aprobado
    if (paymentResult.status !== "approved") {
      console.log(`⚠️ Resultado en buffer no es aprobado (${paymentResult.status}), no se capturará el pago`)
      // Limpiar buffer de todos modos
      await clearPaymentResult(cartId)
      return
    }
    
    // Buscar payment collection asociada a la orden
    let paymentCollectionId: string | null = null
    try {
      const { data: collections } = await query.graph({
        entity: "order_payment_collection",
        fields: ["payment_collection_id"],
        filters: { order_id: orderId },
      })
      
      if (collections && collections.length > 0) {
        paymentCollectionId = collections[0].payment_collection_id
        console.log(`✅ Payment Collection encontrada: ${paymentCollectionId}`)
      } else {
        console.error(`❌ Payment Collection no encontrada para orden ${orderId}`)
        // Limpiar buffer aunque no se pueda capturar
        await clearPaymentResult(cartId)
        return
      }
    } catch (error) {
      console.error('❌ Error buscando payment collection:', error)
      // Limpiar buffer aunque haya error
      await clearPaymentResult(cartId)
      return
    }
    
    // Capturar el pago
    try {
      console.log(`🔍 Retrieving payment collection: ${paymentCollectionId}`)
      const paymentCollection = await paymentModule.retrievePaymentCollection(
        paymentCollectionId,
        { relations: ["payments"] }
      )
      
      console.log(`📦 Payment collection retrieved:`, {
        id: paymentCollection.id,
        status: paymentCollection.status,
        payments_count: paymentCollection.payments?.length || 0,
        payments: paymentCollection.payments?.map((p: any) => ({
          id: p.id,
          status: p.status,
          captured_at: p.captured_at,
          amount: p.amount,
        })) || []
      })
      
      const payment = paymentCollection.payments?.find(
        (p: any) => (p as any).status === "authorized" || !p.captured_at
      )
      
      if (payment) {
        const paymentAny = payment as any
        console.log(`✅ Payment found to capture:`, {
          id: paymentAny.id,
          status: paymentAny.status,
          amount: paymentAny.amount,
          captured_at: paymentAny.captured_at,
        })
        await paymentModule.capturePayment({ payment_id: payment.id })
        console.log(`✅ Pago capturado exitosamente desde buffer para orden ${orderId}`)
        console.log(`   Provider: ${paymentResult.provider}`)
        console.log(`   Transaction ID: ${paymentResult.transaction_id}`)
        console.log(`   Amount: ${paymentResult.amount} ${paymentResult.currency}`)
        
        // Actualizar metadata de la orden con información del pago
        try {
          const metadataKey = `${paymentResult.provider}_status`
          const metadataUpdate: any = {
            [metadataKey]: "APPROVED",
            [`${paymentResult.provider}_transaction_id`]: paymentResult.transaction_id,
            [`${paymentResult.provider}_captured_from_buffer`]: true,
            [`${paymentResult.provider}_captured_at`]: new Date().toISOString(),
          }
          
          // Agregar metadata adicional si existe
          if (paymentResult.metadata) {
            Object.keys(paymentResult.metadata).forEach(key => {
              metadataUpdate[`${paymentResult.provider}_${key}`] = paymentResult.metadata![key]
            })
          }
          
          await orderModuleService.updateOrders([{
            id: orderId,
            metadata: {
              ...order.metadata,
              ...metadataUpdate,
            }
          }])
          
          console.log(`✅ Metadata de orden actualizada con información de pago`)
        } catch (metaError) {
          console.warn(`⚠️ Error actualizando metadata de orden:`, metaError)
          // No fallar si solo falla la metadata
        }
        
        // Enviar notificación de pago capturado
        try {
          console.log(`📱 Enviando notificación de pago capturado para orden ${orderId}`)
          
          // Usar el provider directamente (ahora soporta wompi)
          const provider = paymentResult.provider as "bold" | "addi" | "wompi"
          
          // Mapear status según provider
          let status = "APPROVED"
          if (paymentResult.provider === "bold") {
            status = "SALE_APPROVED"
          } else if (paymentResult.provider === "addi") {
            status = "APPROVED"
          } else if (paymentResult.provider === "wompi") {
            status = "APPROVED"
          }
          
          await notifyPaymentCaptured(
            order,
            status,
            paymentResult.amount,
            paymentResult.transaction_id,
            provider,
            paymentResult.webhook_received_at
          )
          
          console.log(`✅ Notificación de pago capturado enviada exitosamente`)
        } catch (notifError) {
          console.error(`❌ Error enviando notificación de pago capturado:`, notifError)
          // No fallar si solo falla la notificación
        }
        
        // Limpiar buffer después de procesar exitosamente
        await clearPaymentResult(cartId)
        console.log(`✅ Buffer limpiado para cart: ${cartId}`)
      } else {
        console.log(`⚠️ No hay pagos pendientes para capturar en orden ${orderId}`)
        console.log(`   Payment collection status: ${paymentCollection.status}`)
        console.log(`   Available payments:`, paymentCollection.payments?.map((p: any) => ({
          id: p.id,
          status: p.status,
          captured_at: p.captured_at,
        })) || [])
        // Limpiar buffer aunque no haya pagos pendientes
        await clearPaymentResult(cartId)
      }
    } catch (error) {
      console.error(`❌ Error capturando pago desde buffer para orden ${orderId}:`, error)
      // No limpiar buffer si hay error, para que pueda reintentarse
      // El webhook puede llegar después y procesarlo
    }
    
    console.log('✅ Order created payment buffer subscriber completed successfully')
  } catch (error) {
    console.error('❌ Order created payment buffer subscriber error:', error)
    // No lanzar error para no bloquear el flujo de creación de orden
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.created', 'order.completed']
}

