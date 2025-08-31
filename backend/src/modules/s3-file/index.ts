import { ModuleProviderExports } from '@medusajs/framework/types'
import S3FileProviderService from './service'

const services = [S3FileProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
