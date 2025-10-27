import LocalFulfillmentProvider from "./service/local-fulfillment"
import { 
  ModuleProvider, 
  Modules
} from "@medusajs/framework/utils"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [LocalFulfillmentProvider],
})
