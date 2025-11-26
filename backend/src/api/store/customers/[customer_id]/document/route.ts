import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

interface UpdateDocumentBody {
    document_number: string;
    document_type?: string; // CC, CE, NIT, etc. Default: CC
}

/**
 * POST /store/customers/:customer_id/document
 * 
 * Guarda la cédula de ciudadanía en el metadata del customer
 * 
 * Body:
 * {
 *   "document_number": "1234567890",
 *   "document_type": "CC" // opcional, default: CC
 * }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const { customer_id } = req.params;
        const { document_number, document_type = "CC" } = req.body as UpdateDocumentBody;

        if (!customer_id) {
            return res.status(400).json({ 
                success: false,
                error: "customer_id es requerido" 
            });
        }

        if (!document_number) {
            return res.status(400).json({ 
                success: false,
                error: "document_number es requerido" 
            });
        }

        const customerModuleService = req.scope.resolve(Modules.CUSTOMER);

        // Verificar si el customer existe
        let customer;
        try {
            customer = await customerModuleService.retrieveCustomer(customer_id);
        } catch (error) {
            return res.status(404).json({ 
                success: false,
                error: "Customer no encontrado" 
            });
        }

        if (!customer) {
            return res.status(404).json({ 
                success: false,
                error: "Customer no encontrado" 
            });
        }

        // Actualizar el metadata del customer con el documento
        const existingMetadata = customer.metadata || {};
        const updatedMetadata = {
            ...existingMetadata,
            document_number: document_number,
            document_type: document_type,
        };

        await customerModuleService.updateCustomers(customer_id, {
            metadata: updatedMetadata,
        });

        return res.status(200).json({
            success: true,
            message: "Documento guardado exitosamente",
            data: {
                customer_id: customer_id,
                document_number: document_number,
                document_type: document_type,
            }
        });

    } catch (error) {
        console.error("Error guardando documento del customer:", error);
        return res.status(500).json({ 
            success: false,
            error: "Error interno del servidor" 
        });
    }
};

/**
 * GET /store/customers/:customer_id/document
 * 
 * Obtiene el documento del customer desde su metadata
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const { customer_id } = req.params;

        if (!customer_id) {
            return res.status(400).json({ 
                success: false,
                error: "customer_id es requerido" 
            });
        }

        const customerModuleService = req.scope.resolve(Modules.CUSTOMER);

        // Verificar si el customer existe
        let customer;
        try {
            customer = await customerModuleService.retrieveCustomer(customer_id);
        } catch (error) {
            return res.status(404).json({ 
                success: false,
                error: "Customer no encontrado" 
            });
        }

        if (!customer) {
            return res.status(404).json({ 
                success: false,
                error: "Customer no encontrado" 
            });
        }

        const metadata = customer.metadata as any || {};

        return res.status(200).json({
            success: true,
            data: {
                customer_id: customer_id,
                document_number: metadata.document_number || null,
                document_type: metadata.document_type || null,
                has_document: !!metadata.document_number,
            }
        });

    } catch (error) {
        console.error("Error obteniendo documento del customer:", error);
        return res.status(500).json({ 
            success: false,
            error: "Error interno del servidor" 
        });
    }
};

