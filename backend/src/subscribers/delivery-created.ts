import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { IOrderModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { notifyOrderDelivered } from '../lib/notification-service'

/**
 * Subscriber que se ejecuta cuando se crea un delivery (fulfillment marcado como entregado).
 * Envía notificación WhatsApp al cliente.
 *
 * Nota: El evento delivery.created en Medusa emite data: { id: fulfillment_id }
 */
export default async function deliveryCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    if (!data?.id) {
      process.stderr.write('[DeliveryCreated] No fulfillment ID in event data\n')
      return
    }

    const fulfillmentId = data.id
    const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Obtener order_id desde order_fulfillment
    const { data: orderFulfillments } = await query.graph({
      entity: 'order_fulfillment',
      fields: ['order_id'],
      filters: { fulfillment_id: fulfillmentId },
    })

    if (!orderFulfillments?.length) {
      process.stderr.write(`[DeliveryCreated] No order found for fulfillment ${fulfillmentId}\n`)
      return
    }

    const orderId = orderFulfillments[0].order_id

    let order
    try {
      order = await orderModuleService.retrieveOrder(orderId, {
        relations: ['shipping_address'],
      })
    } catch (error) {
      process.stderr.write(`[DeliveryCreated] Error retrieving order: ${error}\n`)
      return
    }

    if (!order) {
      process.stderr.write(`[DeliveryCreated] Order not found: ${orderId}\n`)
      return
    }

    try {
      await notifyOrderDelivered(order)
    } catch (error) {
      process.stderr.write(`[DeliveryCreated] Error sending notification: ${error}\n`)
    }
  } catch (error) {
    process.stderr.write(`[DeliveryCreated] Subscriber error: ${error}\n`)
  }
}

export const config: SubscriberConfig = {
  event: ['delivery.created'],
}
