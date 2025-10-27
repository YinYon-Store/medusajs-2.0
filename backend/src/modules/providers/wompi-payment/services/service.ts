import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeleteAccountHolderInput,
  DeleteAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
const { generateWompiHash } = require("../utils/wompi-hash.js")


export class WompiPaymentProvider extends AbstractPaymentProvider {
  static identifier = "wompi"

  constructor(container, options: Record<string, unknown>) {
    super(container, {
      id: "wompi",
      name: "Wompi",
    })
  }


  getIdentifier(): string {
    return WompiPaymentProvider.identifier
  }

  async getStatus(_): Promise<string> {
    return "pending"
  }

  async getPaymentData(_): Promise<Record<string, unknown>> {
    return {}
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    
    // Obtener cart_id del data (donde llega realmente)
    const cartId = (input.data as any)?.cart_id
    
    if (!cartId) {
      throw new Error("Cart ID no encontrado en el contexto del pago")
    }

    const integrityKey = process.env.WOMPI_INTEGRITY_KEY || process.env.WOMPI_INTEGRITY_SECRET
    const amount = input.amount.toString()
    const currency = "COP"

    // Usar cart_id como reference para Wompi
    const reference = cartId

    // Generar el hash usando la función JS externa
    const signature = await generateWompiHash(
      reference,
      Number(amount)*100,
      currency,
      integrityKey
    )

    return {
      data: {
        publicKey: process.env.WOMPI_PUBLIC_KEY,
        reference: reference,
        amount_in_cents: (Number(amount)*100).toString(),
        currency: currency,
        signature: signature,
        redirectUrl: process.env.WOMPI_REDIRECT_URL,
      },
      id: reference,
      status: PaymentSessionStatus.PENDING
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    try {
      // Extraer el ID de la transacción del contexto
      const transactionId = (input.context as any)?.transaction_id || (input.context as any)?.reference
      
      if (!transactionId) {
        return { status: PaymentSessionStatus.PENDING }
      }

      // Hacer llamada a la API de Wompi para verificar el estado
      const wompiApiUrl = process.env.WOMPI_ENVIRONMENT === 'prod' 
        ? 'https://production.wompi.co/v1'
        : 'https://sandbox.wompi.co/v1'
      
      const response = await fetch(`${wompiApiUrl}/transactions/${transactionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.WOMPI_PRIVATE_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        console.error(`Error consultando estado en Wompi: ${response.status}`)
        return { status: PaymentSessionStatus.PENDING }
      }

      const transactionData = await response.json()
      const status = transactionData.data?.status

      // Mapear estados de Wompi a estados de Medusa
      switch (status) {
        case "APPROVED":
          return { status: PaymentSessionStatus.AUTHORIZED }
        case "DECLINED":
        case "ERROR":
        case "VOIDED":
          return { status: PaymentSessionStatus.CANCELED }
        case "PENDING":
        default:
          return { status: PaymentSessionStatus.PENDING }
      }
    } catch (error) {
      console.error("Error consultando estado de pago en Wompi:", error)
      return { status: PaymentSessionStatus.PENDING }
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: {} }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return { data: {}, status: PaymentSessionStatus.AUTHORIZED }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: {} }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return { data: {} }
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    return { id: input.context.customer.id }
  }

  async deleteAccountHolder(
    input: DeleteAccountHolderInput
  ): Promise<DeleteAccountHolderOutput> {
    return { data: {} }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    return { data: {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: {} }
  }

  async getWebhookActionAndData(
    data: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}