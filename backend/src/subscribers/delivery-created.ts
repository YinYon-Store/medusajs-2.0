import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { IOrderModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { notifyOrderDelivered } from '../lib/notification-service'

/**
 * Subscriber que se ejecuta cuando una orden es marcada como entregada.
 * Envía la notificación WhatsApp de orden entregada al cliente.
 */
export default async function deliveryCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    if (!data?.id) {
      console.error('[DeliveryCreated] No fulfillment ID in event data')
      return
    }

    const fulfillmentId = data.id
    const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Obtener order_id desde order_fulfillment (fulfillment_id -> order_id)
    const { data: orderFulfillments } = await query.graph({
      entity: 'order_fulfillment',
      fields: ['order_id'],
      filters: { fulfillment_id: fulfillmentId },
    })

    if (!orderFulfillments?.length) {
      console.error('[DeliveryCreated] Order not found for fulfillment:', fulfillmentId)
      return
    }

    const orderId = orderFulfillments[0].order_id

    const order = await orderModuleService.retrieveOrder(orderId, {
      relations: ['shipping_address'],
    })

    if (!order) {
      console.error('[DeliveryCreated] Order not found:', orderId)
      return
    }

    await notifyOrderDelivered(order)
  } catch (error) {
    console.error('[DeliveryCreated] Error sending order delivered notification:', error)
  }
}

export const config: SubscriberConfig = {
  event: ['delivery.created'],
}
