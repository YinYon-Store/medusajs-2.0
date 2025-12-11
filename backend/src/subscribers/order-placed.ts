import { Modules } from '@medusajs/framework/utils'
import { INotificationModuleService, IOrderModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { EmailTemplates } from '../modules/email-notifications/templates'
import { notifyOrderCreated } from '../lib/notification-service'

// Log that subscriber is registered
console.log('📋 Order placed subscriber registered - listening for events: order.placed, order.created, order.completed')

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  console.log('📦 Order placed subscriber triggered - Order ID:', data?.id)
  
  try {
    const notificationModuleService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
    const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
    
    if (!data?.id) {
      console.error('❌ Order placed subscriber: No order ID in event data')
      return
    }
    
    console.log('📦 Retrieving order:', data.id)
    const order = await orderModuleService.retrieveOrder(data.id, { relations: ['items', 'summary', 'shipping_address'] })
    
    if (!order) {
      console.error('❌ Order placed subscriber: Order not found')
      return
    }
    
    console.log('✅ Order retrieved successfully - Display ID:', order.display_id)
    
    if (!order.shipping_address?.id) {
      console.warn('⚠️ Order placed subscriber: No shipping address found')
    } else {
      const shippingAddress = await (orderModuleService as any).orderAddressService_.retrieve(order.shipping_address.id)
      console.log('✅ Shipping address retrieved')
    }

    // Send email notification
    try {
      console.log('📧 Sending email notification to:', order.email)
      await notificationModuleService.createNotifications({
        to: order.email,
        channel: 'email',
        template: EmailTemplates.ORDER_PLACED,
        data: {
          emailOptions: {
            replyTo: 'info@example.com',
            subject: 'Your order has been placed'
          },
          order,
          shippingAddress: order.shipping_address ? await (orderModuleService as any).orderAddressService_.retrieve(order.shipping_address.id) : null,
          preview: 'Thank you for your order!'
        }
      })
      console.log('✅ Email notification sent successfully')
    } catch (error) {
      console.error('❌ Error sending order confirmation notification:', error)
    }

    // Send WhatsApp notification
    try {
      console.log('📱 Sending WhatsApp notification for order:', order.id)
      await notifyOrderCreated(order)
      console.log('✅ WhatsApp notification sent successfully')
    } catch (error) {
      console.error('❌ Error sending WhatsApp order created notification:', error)
    }
    
    console.log('✅ Order placed subscriber completed successfully')
  } catch (error) {
    console.error('❌ Order placed subscriber error:', error)
    throw error
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.created', 'order.completed']
}
