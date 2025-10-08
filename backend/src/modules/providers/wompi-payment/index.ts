import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { WompiPaymentProvider } from "./services/service"

const services = [WompiPaymentProvider]

export default ModuleProvider(Modules.PAYMENT, {
  services,
})