import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { IPromotionModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { code, is_active, campaign_id } = req.query;
    
    const promotionModuleService: IPromotionModuleService = req.scope.resolve(Modules.PROMOTION);

    // Construir filtros
    const filters: any = {};
    
    if (code) {
      filters.code = code;
    }
    
    if (is_active !== undefined) {
      filters.is_automatic = is_active === 'true';
    }
    
    if (campaign_id) {
      filters.campaign_id = campaign_id;
    }

    // Obtener promociones
    const promotions = await promotionModuleService.listPromotions(filters, {
      relations: ["campaign", "rules", "application_method"]
    });

    // Extraer solo los códigos de promoción activos
    const promoCodes = promotions
      .filter(promotion => promotion.code) // Solo promociones con código
      .map(promotion => ({
        id: promotion.id,
        code: promotion.code,
        type: promotion.type,
        is_automatic: promotion.is_automatic,
        campaign: promotion.campaign,
        application_method: promotion.application_method,
        rules: promotion.rules
      }));

    return res.json({
      promo_codes: promoCodes,
      count: promoCodes.length,
      filters: {
        code,
        is_active,
        campaign_id
      }
    });

  } catch (error) {
    console.error("Error fetching promo codes:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
};

// Endpoint para validar un código específico
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        error: "Promo code is required"
      });
    }

    const promotionModuleService: IPromotionModuleService = req.scope.resolve(Modules.PROMOTION);

    // Buscar promoción por código
    const promotions = await promotionModuleService.listPromotions({
      code: code
    }, {
      relations: ["campaign", "rules", "application_method"]
    });

    if (promotions.length === 0) {
      return res.status(404).json({
        error: "Promo code not found",
        code: code
      });
    }

    const promotion = promotions[0];

    return res.json({
      valid: true,
      promotion: {
        id: promotion.id,
        code: promotion.code,
        type: promotion.type,
        is_automatic: promotion.is_automatic,
        campaign: promotion.campaign,
        application_method: promotion.application_method,
        rules: promotion.rules
      }
    });

  } catch (error) {
    console.error("Error validating promo code:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
};

