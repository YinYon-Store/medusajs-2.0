import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { BoldPaymentProvider } from "./services/service"

const services = [BoldPaymentProvider]

export default ModuleProvider(Modules.PAYMENT, {
    services,
})
