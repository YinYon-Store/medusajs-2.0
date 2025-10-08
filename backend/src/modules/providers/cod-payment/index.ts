import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { CashOnDeliveryProvider } from "./services/service"

const services = [CashOnDeliveryProvider]

export default ModuleProvider(Modules.PAYMENT, {
  services,
})