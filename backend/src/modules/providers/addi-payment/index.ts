import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { AddiPaymentProvider } from "./services/service"

const services = [AddiPaymentProvider]

export default ModuleProvider(Modules.PAYMENT, {
    services,
})

