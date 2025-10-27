import {
  AbstractFulfillmentProviderService,
  Modules,
} from "@medusajs/framework/utils"
import {
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CreateFulfillmentResult,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
  CalculateShippingOptionPriceContext,
  CalculatedShippingOptionPrice,
  FilterableFulfillmentSetProps
} from "@medusajs/framework/types"

class LocalFulfillmentProvider extends AbstractFulfillmentProviderService {
  static identifier = "local-fulfillment"

  // Puedes guardar la referencia al contenedor si necesitas usarlo luego
  constructor() {
    super();
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: "local-fulfillment" }]
  }

  private createWhatsAppMessage(
    displayId: string | number | undefined,
    carrierName: string | undefined,
    trackingNumber: string | number | undefined
  ): string {
    const orderNumber = displayId ? `#${displayId}` : 'tu orden'
    const carrier = carrierName || 'nuestro transportista'
    const tracking = trackingNumber || 'la guía de seguimiento'
    
    return `¡Hola! 🚚 ${orderNumber} se ha enviado a través de ${carrier} con la guía ${tracking}. ¡Gracias por tu compra!`
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
   


    // Generate WhatsApp message if carrier and tracking are provided
    let whatsappMessage = ""
    if (data.carrierName && data.trackingNumber) {
      whatsappMessage = this.createWhatsAppMessage(
        order?.display_id,
        data.carrierName as string,
        data.trackingNumber as string
      )
    }

    // Add message to fulfillment metadata
    var fulfillmentData = {
      ...data,
    }
    var labels = []
    if(order?.version === 2) {
      fulfillmentData = {
        ...fulfillmentData,
        whatsapp_message: whatsappMessage,
        carrier_name: data.carrierName,
        tracking_number: data.trackingNumber
      }
      labels.push({
        tracking_number: data.trackingNumber,
        tracking_url: `https://www.google.com/search?q=${data.trackingNumber}`,
        label_url: `https://www.google.com/search?q=${data.trackingNumber}`,
      })
    }
      
    return {
      data: fulfillmentData,
      labels: labels,
    }
  }

  async cancelFulfillment(): Promise<any> {
    return {}
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<any> {
    return data
  }
}

export default LocalFulfillmentProvider
