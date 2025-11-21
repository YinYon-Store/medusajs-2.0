import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { IPromotionModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const promotionModuleService: IPromotionModuleService = req.scope.resolve(Modules.PROMOTION);

    // Filtrar promociones automáticas activas
    const activePromotions = await promotionModuleService.listPromotions(
      {
        is_automatic: true,
        status: ["active"]
      },
      {
        relations: [
          "campaign",
          "application_method",
          "application_method.target_rules",
          "application_method.target_rules.values",
          "application_method.buy_rules"
        ]
      }
    );

    // Formatear la respuesta con información relevante
    const formattedPromotions = activePromotions.map((promotion) => ({
      id: promotion.id,
      code: promotion.code,
      type: promotion.type,
      status: promotion.status,
      is_automatic: promotion.is_automatic,
      is_tax_inclusive: promotion.is_tax_inclusive,
      campaign: promotion.campaign ? {
        id: promotion.campaign.id,
        name: promotion.campaign.name,
        campaign_identifier: promotion.campaign.campaign_identifier,
        starts_at: promotion.campaign.starts_at,
        ends_at: promotion.campaign.ends_at
      } : null,
      application_method: promotion.application_method ? {
        id: promotion.application_method.id,
        type: promotion.application_method.type,
        allocation: promotion.application_method.allocation,
        value: promotion.application_method.value,
        currency_code: promotion.application_method.currency_code,
        max_quantity: promotion.application_method.max_quantity,
        target_rules: promotion.application_method.target_rules,
        buy_rules: promotion.application_method.buy_rules
      } : null,
      rules: promotion.rules?.map((rule: any) => ({
        id: rule.id,
        description: rule.description,
        attribute: rule.attribute,
        operator: rule.operator,
        values: rule.values
      })) || []
    }));

    return res.json({
      promotions: formattedPromotions,
      count: formattedPromotions.length
    });

  } catch (error) {
    console.error("Error fetching active automatic promotions:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
};

