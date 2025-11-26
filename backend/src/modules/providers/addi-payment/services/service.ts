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

// Interfaces para ADDI
interface AddiConfigResponse {
    minAmount: number;
    maxAmount: number;
    policy: {
        discount: number;
        productType: string;
        policyMaxAmount: number;
        isVisible: boolean;
    };
    policies: Array<{
        discount: number;
        productType: string;
        policyMaxAmount: number;
        isVisible: boolean;
    }>;
    isActiveAlly: boolean;
    isActivePayNow: boolean;
}

interface AddiAuthResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

interface AddiApplicationRequest {
    orderId: string;
    totalAmount: string;
    shippingAmount: string;
    totalTaxesAmount: string;
    currency: string;
    items: Array<{
        sku: string;
        name: string;
        quantity: string;
        unitPrice: number;
        tax: number;
        pictureUrl: string;
        category: string;
        brand: string;
    }>;
    client: {
        idType: string;
        idNumber: string;
        firstName: string;
        lastName: string;
        email: string;
        cellphone: string;
        cellphoneCountryCode: string;
        address: {
            lineOne: string;
            city: string;
            country: string;
        };
    };
    shippingAddress: {
        lineOne: string;
        city: string;
        country: string;
    };
    billingAddress: {
        lineOne: string;
        city: string;
        country: string;
    };
    pickUpAddress: {
        lineOne: string;
        city: string;
        country: string;
    };
    allyUrlRedirection: {
        logoUrl: string;
        callbackUrl: string;
        redirectionUrl: string;
    };
    geoLocation?: {
        latitude: string;
        longitude: string;
    };
}

export class AddiPaymentProvider extends AbstractPaymentProvider {
    static identifier = "addi"

    private clientId: string;
    private clientSecret: string;
    private allySlug: string;
    private environment: string;
    private redirectUrl: string;
    private callbackUrl: string;
    private logoUrl: string;
    private authUrl: string;
    private apiUrl: string;
    private configUrl: string;
    private audience: string;

    constructor(container: any, options: Record<string, unknown>) {
        super(container, {
            id: "addi",
            name: "ADDI",
        })
        
        this.clientId = (options.clientId as string) || '';
        this.clientSecret = (options.clientSecret as string) || '';
        this.allySlug = (options.allySlug as string) || 'inversionesauracolombia-ecommerce';
        this.environment = (options.environment as string) || 'staging';
        this.redirectUrl = (options.redirectUrl as string) || '';
        this.callbackUrl = (options.callbackUrl as string) || '';
        this.logoUrl = (options.logoUrl as string) || '';
        
        // URLs from environment configuration
        this.authUrl = (options.authUrl as string) || 'https://auth.addi-staging.com/oauth/token';
        this.apiUrl = (options.apiUrl as string) || 'https://api.addi-staging.com';
        this.configUrl = (options.configUrl as string) || 'https://channels-public-api.addi.com';
        this.audience = (options.audience as string) || 'https://api.staging.addi.com';
        
        console.log(`🔧 ADDI Provider initialized - Environment: ${this.environment}`);
        console.log(`   Auth URL: ${this.authUrl}`);
        console.log(`   API URL: ${this.apiUrl}`);
        console.log(`   Config URL: ${this.configUrl}`);
    }

    /**
     * Obtiene los datos completos del carrito y cliente via API interna
     * Usa el endpoint /store/cart/:cart_id/details
     */
    private async getCartDetails(cartId: string): Promise<{ cart: any; customer: any } | null> {
        try {
            const backendUrl = process.env.BACKEND_URL || process.env.BACKEND_PUBLIC_URL || 'http://localhost:9000';
            const publishableApiKey = process.env.STORE_PUBLISHABLE_API_KEY;
            const url = `${backendUrl}/store/cart/${cartId}/details`;
            
            console.log(`🔍 ADDI - Obteniendo datos del carrito desde: ${url}`);
            
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            
            // Agregar API key si está disponible
            if (publishableApiKey) {
                headers['x-publishable-api-key'] = publishableApiKey;
            }
            
            const response = await fetch(url, {
                method: 'GET',
                headers,
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ ADDI - Error obteniendo carrito: ${response.status}`, errorText);
                return null;
            }

            const data = await response.json();
            console.log(`✅ ADDI - Datos del carrito obtenidos:`, {
                cart_id: data.cart?.id,
                email: data.cart?.email,
                items_count: data.cart?.items?.length,
                has_customer: !!data.customer,
            });
            
            return data;
        } catch (error) {
            console.error('❌ ADDI - Error obteniendo datos del carrito:', error);
            return null;
        }
    }

    /**
     * Obtiene las URLs base (ya configuradas desde el ambiente)
     */
    private getUrls() {
        return {
            authUrl: this.authUrl,
            apiUrl: this.apiUrl,
            configUrl: this.configUrl,
            audience: this.audience,
        };
    }

    /**
     * Verifica si el monto está dentro del rango permitido por ADDI
     */
    private async verifyAmount(amount: number): Promise<{ valid: boolean; config?: AddiConfigResponse; error?: string }> {
        try {
            const { configUrl } = this.getUrls();
            const url = `${configUrl}/allies/${this.allySlug}/config?requestedAmount=${amount}`;
            
            console.log(`🔍 ADDI - Verificando monto: ${amount} en ${url}`);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                console.error(`❌ ADDI - Error verificando configuración: ${response.status}`);
                return { valid: false, error: `Error consultando configuración ADDI: ${response.status}` };
            }

            const config: AddiConfigResponse = await response.json();
            console.log(`✅ ADDI - Configuración obtenida:`, { minAmount: config.minAmount, maxAmount: config.maxAmount, isActiveAlly: config.isActiveAlly });

            if (!config.isActiveAlly) {
                return { valid: false, error: 'ADDI no está activo para este aliado' };
            }

            if (amount < config.minAmount) {
                return { valid: false, error: `El monto mínimo para ADDI es ${config.minAmount} COP`, config };
            }

            if (amount > config.maxAmount) {
                return { valid: false, error: `El monto máximo para ADDI es ${config.maxAmount} COP`, config };
            }

            return { valid: true, config };
        } catch (error) {
            console.error('❌ ADDI - Error verificando monto:', error);
            return { valid: false, error: 'Error de conexión con ADDI' };
        }
    }

    /**
     * Obtiene el access token de Auth0 para ADDI
     */
    private async getAccessToken(): Promise<{ token?: string; error?: string }> {
        try {
            const { authUrl, audience } = this.getUrls();
            
            console.log(`🔐 ADDI - Obteniendo access token desde ${authUrl}`);

            const response = await fetch(authUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    audience: audience,
                    grant_type: 'client_credentials',
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ ADDI - Error de autenticación: ${response.status}`, errorText);
                return { error: `Error de autenticación ADDI: ${response.status}` };
            }

            const authData: AddiAuthResponse = await response.json();
            console.log(`✅ ADDI - Token obtenido, expira en ${authData.expires_in}s`);
            
            return { token: authData.access_token };
        } catch (error) {
            console.error('❌ ADDI - Error obteniendo token:', error);
            return { error: 'Error de conexión con autenticación ADDI' };
        }
    }

    /**
     * Crea la aplicación en ADDI y obtiene la URL de redirección
     */
    private async createApplication(
        token: string, 
        applicationData: AddiApplicationRequest
    ): Promise<{ redirectUrl?: string; error?: string }> {
        try {
            const { apiUrl } = this.getUrls();
            const url = `${apiUrl}/v1/online-applications`;
            
            console.log(`📝 ADDI - Creando aplicación en ${url}`);
            console.log(`📦 ADDI - Datos de la aplicación:`, JSON.stringify(applicationData, null, 2));

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(applicationData),
                redirect: 'manual', // Para capturar el 301
            });

            console.log(`📡 ADDI - Response status: ${response.status}`);
            
            // ADDI retorna 301 con Location header
            if (response.status === 301 || response.status === 302) {
                const locationUrl = response.headers.get('Location');
                if (locationUrl) {
                    console.log(`✅ ADDI - URL de redirección obtenida: ${locationUrl}`);
                    return { redirectUrl: locationUrl };
                }
                return { error: 'ADDI no retornó URL de redirección' };
            }

            // Si retorna 200/201, buscar la URL en el body
            if (response.ok) {
                const data = await response.json();
                console.log(`📦 ADDI - Respuesta:`, data);
                if (data.redirectUrl || data.url) {
                    return { redirectUrl: data.redirectUrl || data.url };
                }
            }

            const errorText = await response.text();
            console.error(`❌ ADDI - Error creando aplicación: ${response.status}`, errorText);
            return { error: `Error creando aplicación ADDI: ${response.status} - ${errorText}` };
        } catch (error) {
            console.error('❌ ADDI - Error creando aplicación:', error);
            return { error: 'Error de conexión creando aplicación ADDI' };
        }
    }

    getIdentifier(): string {
        return AddiPaymentProvider.identifier
    }

    async getStatus(_: any): Promise<string> {
        return "pending"
    }

    async getPaymentData(_: any): Promise<Record<string, unknown>> {
        return {}
    }

    async initiatePayment(
        input: InitiatePaymentInput
    ): Promise<InitiatePaymentOutput> {
        console.log("🚀 ADDI - Iniciando pago para input:", input);
        const cartId = (input.data as any)?.cart_id;
        const amount = Number(input.amount);
        
        if (!cartId) {
            throw new Error("Cart ID no encontrado en el contexto del pago");
        }

        // 1. Verificar que el monto esté dentro del rango permitido
        const amountVerification = await this.verifyAmount(amount);
        if (!amountVerification.valid) {
            throw new Error(amountVerification.error || 'Monto no válido para ADDI');
        }

        // 2. Obtener access token
        const authResult = await this.getAccessToken();
        if (!authResult.token) {
            throw new Error(authResult.error || 'Error de autenticación con ADDI');
        }

        // 3. Obtener datos completos del carrito via API interna
        const cartDetails = await this.getCartDetails(cartId);
        if (!cartDetails?.cart) {
            throw new Error("No se pudo obtener los datos del carrito");
        }

        const cart = cartDetails.cart;
        const customer = cartDetails.customer;

        // Extraer direcciones del carrito
        const shippingAddress = cart.shipping_address || {};
        const billingAddress = cart.billing_address || shippingAddress;

        // Extraer nombre y apellido (prioridad: dirección de envío > cliente)
        const firstName = shippingAddress.first_name || customer?.first_name || 'Cliente';
        const lastName = shippingAddress.last_name || customer?.last_name || 'Medusa';

        // Preparar items para ADDI desde los items reales del carrito
        const cartItems = cart.items || [];
        const addiItems = cartItems.length > 0 ? cartItems.map((item: any) => ({
            sku: item.variant_sku || item.variant_id || item.id || 'SKU-DEFAULT',
            name: item.title || item.product_title || 'Producto',
            quantity: String(item.quantity || 1),
            unitPrice: Math.round(Number(item.unit_price || 0)),
            tax: 0, // Tax ya incluido en el precio (is_tax_inclusive: true)
            pictureUrl: item.thumbnail || this.logoUrl || 'https://placeholder.com/product.jpg',
            category: item.product_collection || 'general',
            brand: item.product_collection || 'Default',
        })) : [{
            sku: 'ORDER-ITEM',
            name: 'Orden de compra',
            quantity: '1',
            unitPrice: Math.round(amount),
            tax: 0,
            pictureUrl: this.logoUrl || 'https://placeholder.com/product.jpg',
            category: 'general',
            brand: 'Default',
        }];

        // Calcular shipping (por ahora 0, se puede mejorar si hay shipping_methods)
        const shippingAmount = 0;
        const taxAmount = 0; // Impuestos ya incluidos

        // Preparar dirección de envío
        const shippingAddressLine = shippingAddress.address_1 || 'Dirección no especificada';
        const shippingCity = shippingAddress.city || 'Ciudad';
        const shippingCountry = (shippingAddress.country_code || 'co').toUpperCase();

        // Preparar dirección de facturación
        const billingAddressLine = billingAddress.address_1 || shippingAddressLine;
        const billingCity = billingAddress.city || shippingCity;
        const billingCountry = (billingAddress.country_code || 'co').toUpperCase();

        // Preparar teléfono (prioridad: dirección > cliente)
        let phone = shippingAddress.phone || billingAddress.phone || '';
        // Limpiar teléfono: solo números
        phone = phone.replace(/\D/g, '');
        if (phone.startsWith('57')) phone = phone.substring(2);
        if (phone.length < 10) phone = '3000000000'; // Default si no es válido

        // Obtener email
        const email = cart.email || customer?.email || 'cliente@example.com';

        // Documento de identidad desde metadata del customer
        const documentType: string = (customer?.metadata as any)?.document_type || 'CC';
        const documentNumber: string = (customer?.metadata as any)?.document_number || '';

        console.log(`📄 ADDI - Documento del cliente: ${documentType} ${documentNumber}`);

        const applicationData: AddiApplicationRequest = {
            orderId: cartId,
            totalAmount: String(amount),
            shippingAmount: String(shippingAmount),
            totalTaxesAmount: String(taxAmount),
            currency: 'COP',
            items: addiItems,
            client: {
                idType: documentType,
                idNumber: documentNumber,
                firstName: firstName,
                lastName: lastName,
                email: email,
                cellphone: phone,
                cellphoneCountryCode: '+57',
                address: {
                    lineOne: billingAddressLine,
                    city: billingCity,
                    country: billingCountry,
                },
            },
            shippingAddress: {
                lineOne: shippingAddressLine,
                city: shippingCity,
                country: shippingCountry,
            },
            billingAddress: {
                lineOne: billingAddressLine,
                city: billingCity,
                country: billingCountry,
            },
            pickUpAddress: {
                lineOne: shippingAddressLine,
                city: shippingCity,
                country: shippingCountry,
            },
            allyUrlRedirection: {
                logoUrl: this.logoUrl || 'https://placeholder.com/logo.png',
                callbackUrl: this.callbackUrl || `${process.env.BACKEND_URL || 'http://localhost:9000'}/hooks/addi/payment`,
                redirectionUrl: this.redirectUrl || 'https://example.com/checkout/complete',
            },
        };

        console.log(`📦 ADDI - Datos de la aplicación:`, JSON.stringify(applicationData, null, 2));

        // 4. Crear aplicación en ADDI
        const applicationResult = await this.createApplication(authResult.token, applicationData);
        if (!applicationResult.redirectUrl) {
            throw new Error(applicationResult.error || 'Error creando aplicación ADDI');
        }

        console.log(`✅ ADDI - Pago iniciado exitosamente, redirect URL: ${applicationResult.redirectUrl}`);

        return {
            data: {
                redirectUrl: applicationResult.redirectUrl,
                orderId: cartId,
                amount: amount,
                currency: 'COP',
                minAmount: amountVerification.config?.minAmount,
                maxAmount: amountVerification.config?.maxAmount,
            },
            id: cartId,
            status: PaymentSessionStatus.PENDING,
        };
    }

    async getPaymentStatus(
        input: GetPaymentStatusInput
    ): Promise<GetPaymentStatusOutput> {
        // ADDI notifica el estado via webhook
        return { status: PaymentSessionStatus.PENDING };
    }

    async retrievePayment(
        input: RetrievePaymentInput
    ): Promise<RetrievePaymentOutput> {
        return { data: {} };
    }

    async authorizePayment(
        input: AuthorizePaymentInput
    ): Promise<AuthorizePaymentOutput> {
        return { data: {}, status: PaymentSessionStatus.AUTHORIZED };
    }

    async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
        return { data: {} };
    }

    async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
        return { data: {} };
    }

    async capturePayment(
        input: CapturePaymentInput
    ): Promise<CapturePaymentOutput> {
        return { data: {} };
    }

    async createAccountHolder(
        input: CreateAccountHolderInput
    ): Promise<CreateAccountHolderOutput> {
        return { id: input.context.customer.id };
    }

    async deleteAccountHolder(
        input: DeleteAccountHolderInput
    ): Promise<DeleteAccountHolderOutput> {
        return { data: {} };
    }

    async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
        return { data: {} };
    }

    async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
        return { data: {} };
    }

    async getWebhookActionAndData(
        data: ProviderWebhookPayload["payload"]
    ): Promise<WebhookActionResult> {
        return { action: PaymentActions.NOT_SUPPORTED };
    }
}

