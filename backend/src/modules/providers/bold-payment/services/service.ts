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
const { generateBoldHash } = require("../utils/bold-hash.js")


export class BoldPaymentProvider extends AbstractPaymentProvider {
    static identifier = "bold"

    constructor(container, options: Record<string, unknown>) {
        super(container, {
            id: "bold",
            name: "Bold",
        })
    }


    getIdentifier(): string {
        return BoldPaymentProvider.identifier
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

        const secretKey = process.env.BOLD_SECRET_KEY
        const amount = input.amount.toString()
        const currency = "COP"

        // Usar cart_id como reference para Bold
        const reference = cartId

        // Generar el hash usando la función JS externa
        const signature = await generateBoldHash(
            reference,
            amount,
            currency,
            secretKey
        )
        console.log("signature", signature)
        console.log("reference", reference)
        console.log("amount", amount)
        console.log("currency", currency)
        console.log("secretKey", secretKey)

        return {
            data: {
                publicKey: process.env.BOLD_PUBLIC_KEY,
                reference: reference,
                amount_in_cents: (Number(amount) * 100).toString(),
                currency: currency,
                signature: signature,
                redirectUrl: process.env.BOLD_REDIRECT_URL,
                amount: amount,
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

            // Hacer llamada a la API de Bold para verificar el estado
            // Asumimos URLs similares a Wompi
            const boldApiUrl = process.env.BOLD_ENVIRONMENT === 'prod'
                ? 'https://production.bold.co/v1'
                : 'https://sandbox.bold.co/v1'

            const response = await fetch(`${boldApiUrl}/transactions/${transactionId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.BOLD_PRIVATE_KEY}`,
                    'Content-Type': 'application/json'
                }
            })

            if (!response.ok) {
                console.error(`Error consultando estado en Bold: ${response.status}`)
                return { status: PaymentSessionStatus.PENDING }
            }

            const transactionData = await response.json()
            const status = transactionData.data?.status

            // Mapear estados de Bold a estados de Medusa
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
            console.error("Error consultando estado de pago en Bold:", error)
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
