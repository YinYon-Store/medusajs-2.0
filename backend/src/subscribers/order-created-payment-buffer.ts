import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { IOrderModuleService, IPaymentModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { getPaymentResult, clearPaymentResult } from '../lib/payment-buffer-service'
import { notifyPaymentCaptured, notifyOrderCreated } from '../lib/notification-service'
import { reportError, ErrorCategory, logEvent, AnalyticsEvent } from '../lib/firebase-service'


/**
 * Subscriber que se ejecuta cuando se crea una orden
 * Verifica si hay un resultado de pago en el buffer y lo captura automáticamente
 */
export default async function orderCreatedPaymentBufferHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  try {
    const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
    const paymentModule: IPaymentModuleService = container.resolve(Modules.PAYMENT)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    if (!data?.id) {
      console.error('[PaymentBuffer] No order ID in event data')
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
      console.error('[PaymentBuffer] Error retrieving order:', error)
      return
    }
    
    if (!order) {
      console.error('[PaymentBuffer] Order not found:', orderId)
      return
    }
    
    // Enviar notificación WhatsApp de orden creada (siempre se envía)
    try {
      await notifyOrderCreated(order)
    } catch (error) {
      console.error('[PaymentBuffer] Error sending notification:', error)
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
      } else {
        return
      }
    } catch (error) {
      console.error('[PaymentBuffer] Error finding cart_id:', error)
      return
    }
    
    // Verificar si hay resultado de pago en buffer
    const paymentResult = await getPaymentResult(cartId)
    
    if (!paymentResult) {
      return
    }
    
    // Solo procesar si el resultado es aprobado
    if (paymentResult.status !== "approved") {
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
      } else {
        console.error(`[PaymentBuffer] Payment collection not found for order: ${orderId}`)
        await clearPaymentResult(cartId)
        return
      }
    } catch (error) {
      console.error('[PaymentBuffer] Error finding payment collection:', error)
      await clearPaymentResult(cartId)
      return
    }
    
    // Capturar el pago
    try {
      const paymentCollection = await paymentModule.retrievePaymentCollection(
        paymentCollectionId,
        { relations: ["payments"] }
      )
      
      const payment = paymentCollection.payments?.find(
        (p: any) => (p as any).status === "authorized" || !p.captured_at
      )
      
      if (payment) {
        await paymentModule.capturePayment({ payment_id: payment.id })
        console.log(`[PaymentBuffer] Payment captured: order=${orderId}, provider=${paymentResult.provider}, tx=${paymentResult.transaction_id}`)
        
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
        } catch (metaError) {
          console.warn('[PaymentBuffer] Error updating order metadata:', metaError)
        }
        
        // Enviar notificación de pago capturado
        try {
          const provider = paymentResult.provider as "bold" | "addi" | "wompi"
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
        } catch (notifError) {
          console.error('[PaymentBuffer] Error sending notification:', notifError)
        }
        
        // Limpiar buffer después de procesar exitosamente
        await clearPaymentResult(cartId)
      } else {
        await clearPaymentResult(cartId)
        
        // Log evento de buffer procesado
        await logEvent(AnalyticsEvent.PAYMENT_BUFFER_CLEARED, {
          cart_id: cartId,
          order_id: orderId,
          provider: paymentResult.provider,
        });
      }
    } catch (error) {
      console.error(`[PaymentBuffer] Error capturing payment for order ${orderId}:`, error)
      
      await reportError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.PAYMENT,
        {
          order_id: orderId,
          cart_id: cartId,
          action: 'capture_payment_from_buffer',
        }
      );
    }
    
    await logEvent(AnalyticsEvent.ORDER_CREATED, {
      order_id: orderId,
      cart_id: cartId,
    });
  } catch (error) {
    console.error('[PaymentBuffer] Subscriber error:', error)
    
    await reportError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorCategory.UNKNOWN,
      {
        action: 'order_created_subscriber',
      }
    );
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.created', 'order.completed']
}

