import { z } from 'zod';

// ==========================================
// ENUMS DE ESTADO (MÁQUINA DE ESTADOS EN 2 ETAPAS)
// ==========================================

export enum OrderStatus {
  CREATED = 'CREATED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID_ON_HOLD = 'PAID_ON_HOLD',           // Fondos cobrados, bebidas en wallet listas para canje
  CANCELLED_REFUNDED = 'CANCELLED_REFUNDED'
}

export enum TicketStatus {
  PREP_REQUESTED = 'PREP_REQUESTED',       // Usuario activó "Preparar Ahora" (en cola o evaluando)
  IN_PREPARATION = 'IN_PREPARATION',       // Comanda impresa en barra, bartender preparando
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',   // Pedido listo en ventana de retiro rápido
  DELIVERED = 'DELIVERED',                 // Validado y entregado al cliente (cierre de ciclo)
  CANCELLED_REFUNDED = 'CANCELLED_REFUNDED' // Service recovery (ej. producto agotado)
}

export enum BarStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED'
}

export enum UserRole {
  CONSUMER = 'CONSUMER',
  BAR_OPERATOR = 'BAR_OPERATOR',
  VENUE_ADMIN = 'VENUE_ADMIN',
  INCUBATIO_ADMIN = 'INCUBATIO_ADMIN'
}

export interface JwtAuthPayload {
  sub: string;
  role: UserRole;
  tenantId?: string | null;
  barId?: string | null;
  assignedBarId?: string | null;
  email?: string | null;
  iat?: number;
  exp?: number;
}

// ==========================================
// PALETA ROTATIVA DE COLORES DE SEGURIDAD
// ==========================================
export const SECURITY_COLORS = [
  '#EF4444', // Rojo Neón
  '#3B82F6', // Azul Eléctrico
  '#10B981', // Verde Esmeralda
  '#F59E0B', // Ámbar Intenso
  '#8B5CF6', // Violeta Neón
  '#EC4899', // Fucsia Vibrante
  '#06B6D4', // Cian Resplandeciente
  '#84CC16', // Lima Ácido
] as const;

export type SecurityColor = typeof SECURITY_COLORS[number];

// ==========================================
// ESQUEMAS ZOD Y DTOS DE COMPRA (ETAPA 1)
// ==========================================

export const OrderItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  selectedUpsellId: z.string().uuid().optional(),
});

export const CreateOrderSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string(),
  items: z.array(OrderItemInputSchema).min(1),
});

export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export interface OrderItemDto {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  subtotal: number;
  itemPlatformFee: number;
  itemGatewayFee: number;
  itemTenantNet: number;
  quantityPurchased: number;
  quantityRemaining: number;
  upsellOptionName?: string;
  createdAt: Date;
}

export interface OrderDto {
  id: string;
  userId: string;
  tenantId: string;
  totalAmount: number;
  platformFee: number;
  gatewayFee: number;
  tenantNetAmount: number;
  appliedCommissionPct: number;
  appliedGatewayFeePct: number;
  paymentStatus: OrderStatus;
  mpPreferenceId?: string;
  mpPaymentId?: string;
  items: OrderItemDto[];
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// MOTOR DE ARITMÉTICA DECIMAL EXACTA (CENTAVOS BIGINT)
// ==========================================

export interface ItemFinancialInput {
  productId: string;
  basePrice: number;
  upsellPrice?: number;
  quantity: number;
  selectedUpsellId?: string;
}

export interface CalculatedItemBreakdown {
  productId: string;
  unitPrice: number;
  subtotal: number;
  itemPlatformFee: number;
  itemGatewayFee: number;
  itemTenantNet: number;
  quantityPurchased: number;
  selectedUpsellId?: string;
}

export interface OrderFinancialBreakdown {
  totalAmount: number;
  platformFee: number;
  gatewayFee: number;
  tenantNetAmount: number;
  appliedCommissionPct: number;
  appliedGatewayFeePct: number;
  items: CalculatedItemBreakdown[];
}

/**
 * Convierte un monto decimal (ej. 9500.50) a centavos enteros exactos (BigInt)
 * mediante parseo de string para evitar errores de coma flotante IEEE 754.
 */
export function toExactCents(amount: number | string): bigint {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`Monto financiero inválido: ${amount}`);
  }
  const fixed = normalized.toFixed(2);
  const [whole, frac = '00'] = fixed.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
}

/**
 * Convierte centavos enteros (BigInt) de vuelta a número con 2 decimales exactos.
 */
export function fromExactCents(cents: bigint): number {
  const isNegative = cents < 0n;
  const abs = isNegative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return Number(`${isNegative ? '-' : ''}${whole}.${frac}`);
}

/**
 * Convierte un porcentaje (0 a 100, hasta 4 decimales, ej. 10.25%) a micro-unidades (100% = 1_000_000n)
 */
export function rateToMicroUnits(pct: number | string): bigint {
  const normalized = Number(pct);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    throw new Error(`Porcentaje financiero fuera de rango (0-100): ${pct}`);
  }
  const fixed = normalized.toFixed(4);
  const [whole, frac = '0000'] = fixed.split('.');
  return BigInt(whole) * 10000n + BigInt(frac.padEnd(4, '0').slice(0, 4));
}

/**
 * Calcula comisión en centavos con redondeo comercial Half-Up exacto en BigInt.
 */
export function computeFeeCents(amountCents: bigint, rateMicro: bigint): bigint {
  return (amountCents * rateMicro + 500_000n) / 1_000_000n;
}

/**
 * Calcula el desglose financiero exacto por bebida y por orden,
 * garantizando reconciliación de centavos (Suma Cero: Neto + Tutrago + Pasarela === Total).
 */
export function calculateOrderFinancials(
  items: ItemFinancialInput[],
  commissionPct?: number | null,
  gatewayFeePct?: number | null
): OrderFinancialBreakdown {
  const safeCommissionPct =
    commissionPct !== undefined && commissionPct !== null && Number.isFinite(Number(commissionPct))
      ? Number(commissionPct)
      : 10.0;
  const safeGatewayFeePct =
    gatewayFeePct !== undefined && gatewayFeePct !== null && Number.isFinite(Number(gatewayFeePct))
      ? Number(gatewayFeePct)
      : 4.5;

  if (safeCommissionPct + safeGatewayFeePct > 100) {
    throw new Error(
      `La suma de comisión Tutrago (${safeCommissionPct}%) y pasarela (${safeGatewayFeePct}%) no puede superar el 100%.`
    );
  }

  const commissionMicro = rateToMicroUnits(safeCommissionPct);
  const gatewayMicro = rateToMicroUnits(safeGatewayFeePct);

  let totalCents = 0n;
  const rawItems = items.map((item) => {
    const qty = BigInt(item.quantity);
    const unitCents = toExactCents(item.basePrice) + toExactCents(item.upsellPrice ?? 0);
    const subtotalCents = unitCents * qty;
    totalCents += subtotalCents;

    const platformFeeCents = computeFeeCents(subtotalCents, commissionMicro);
    const gatewayFeeCents = computeFeeCents(subtotalCents, gatewayMicro);
    const tenantNetCents = subtotalCents - platformFeeCents - gatewayFeeCents;

    return {
      productId: item.productId,
      selectedUpsellId: item.selectedUpsellId,
      quantityPurchased: item.quantity,
      unitCents,
      subtotalCents,
      platformFeeCents,
      gatewayFeeCents,
      tenantNetCents,
    };
  });

  // Cálculo a nivel orden
  const orderPlatformFeeCents = computeFeeCents(totalCents, commissionMicro);
  const orderGatewayFeeCents = computeFeeCents(totalCents, gatewayMicro);
  const orderTenantNetCents = totalCents - orderPlatformFeeCents - orderGatewayFeeCents;

  // Reconciliación de centavos residuales en el ítem de mayor subtotal para cuadratura contable exacta
  if (rawItems.length > 0) {
    const sumPlatform = rawItems.reduce((acc, i) => acc + i.platformFeeCents, 0n);
    const sumGateway = rawItems.reduce((acc, i) => acc + i.gatewayFeeCents, 0n);
    const diffPlatform = orderPlatformFeeCents - sumPlatform;
    const diffGateway = orderGatewayFeeCents - sumGateway;

    if (diffPlatform !== 0n || diffGateway !== 0n) {
      let maxIdx = 0;
      for (let i = 1; i < rawItems.length; i++) {
        if (rawItems[i].subtotalCents > rawItems[maxIdx].subtotalCents) {
          maxIdx = i;
        }
      }
      rawItems[maxIdx].platformFeeCents += diffPlatform;
      rawItems[maxIdx].gatewayFeeCents += diffGateway;
      rawItems[maxIdx].tenantNetCents =
        rawItems[maxIdx].subtotalCents -
        rawItems[maxIdx].platformFeeCents -
        rawItems[maxIdx].gatewayFeeCents;
    }
  }

  return {
    totalAmount: fromExactCents(totalCents),
    platformFee: fromExactCents(orderPlatformFeeCents),
    gatewayFee: fromExactCents(orderGatewayFeeCents),
    tenantNetAmount: fromExactCents(orderTenantNetCents),
    appliedCommissionPct: safeCommissionPct,
    appliedGatewayFeePct: safeGatewayFeePct,
    items: rawItems.map((i) => ({
      productId: i.productId,
      selectedUpsellId: i.selectedUpsellId,
      quantityPurchased: i.quantityPurchased,
      unitPrice: fromExactCents(i.unitCents),
      subtotal: fromExactCents(i.subtotalCents),
      itemPlatformFee: fromExactCents(i.platformFeeCents),
      itemGatewayFee: fromExactCents(i.gatewayFeeCents),
      itemTenantNet: fromExactCents(i.tenantNetCents),
    })),
  };
}

// ==========================================
// ESQUEMAS DE PAGO CON TARJETA Y SIMULADOR PILOTO
// ==========================================

export const ProcessCardPaymentSchema = z.object({
  orderId: z.string().uuid(),
  cardNumber: z.string().min(13).max(19),
  cardholderName: z.string().min(2),
  expirationDate: z.string().min(4),
  securityCode: z.string().min(3).max(4),
  identificationNumber: z.string().optional(),
  installments: z.number().int().positive().default(1),
  paymentMethodId: z.string().default('visa'),
  cardStatusHint: z.enum(['APRO', 'FUND', 'SECU', 'OTHE', 'EXPI', 'CALL']).optional(),
});

export type ProcessCardPaymentInput = z.infer<typeof ProcessCardPaymentSchema>;

export const PilotSimulationActionSchema = z.object({
  orderId: z.string().uuid(),
  action: z.enum(['APPROVE', 'REJECT_FUNDS', 'REJECT_SECURITY', 'REFUND']),
  pilotPin: z.string().min(4),
  operatorNote: z.string().optional(),
});

export type PilotSimulationActionInput = z.infer<typeof PilotSimulationActionSchema>;

export const UpdateTenantFinancialConfigSchema = z.object({
  commissionPct: z.number().min(0).max(50).optional(),
  gatewayFeePct: z.number().min(0).max(30).optional(),
  sandboxMode: z.boolean().optional(),
  mpAccessToken: z.string().optional(),
});

export type UpdateTenantFinancialConfigInput = z.infer<typeof UpdateTenantFinancialConfigSchema>;

// ==========================================
// ESQUEMAS ZOD Y DTOS DE RETIRO / PICKUP (ETAPA 2)
// ==========================================

export const ActivatePickupItemSchema = z.object({
  orderItemId: z.string().uuid(),
  quantityToRedeem: z.number().int().positive(),
});

export const ActivatePickupSchema = z.object({
  userId: z.string(),
  barId: z.string().uuid(),
  items: z.array(ActivatePickupItemSchema).min(1),
});

export type ActivatePickupItem = z.infer<typeof ActivatePickupItemSchema>;
export type ActivatePickupInput = z.infer<typeof ActivatePickupSchema>;

export interface PickupTicketItemDto {
  id: string;
  ticketId: string;
  productName: string;
  quantity: number;
}

export interface PickupTicketDto {
  id: string;
  orderId: string;
  barId: string;
  barName: string;
  status: TicketStatus;
  shortCode: string;           // Ej: "A47" (1 letra + 2 dígitos)
  securityColor: string;       // Hex rotativo para match visual
  offlineQrToken: string;      // JWT firmado offline
  items: PickupTicketItemDto[];
  activatedAt: Date;
  readyAt?: Date;
  deliveredAt?: Date;
}

// ==========================================
// TOKEN OFFLINE-FIRST (PAYLOAD CRIPTOGRÁFICO JWT)
// ==========================================

export interface OfflineQrPayload {
  ticketId: string;
  shortCode: string;
  barId: string;
  securityColor: string;
  jti?: string;
  items: Array<{
    name: string;
    quantity: number;
  }>;
  iat: number;
  exp: number;
}

// ==========================================
// CATÁLOGO Y SERVICE RECOVERY
// ==========================================

export interface ProductUpsellDto {
  id: string;
  title: string;
  additionalPrice: number;
  description?: string;
}

export interface ProductDto {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  imageUrl?: string;
  isAvailable: boolean;
  upsells: ProductUpsellDto[];
}

export interface ServiceRecoveryOption {
  type: 'SUBSTITUTION' | 'REFUND';
  originalItemId: string;
  availableSubstitutes?: Array<{
    productId: string;
    name: string;
    price: number;
  }>;
  refundableAmount?: number;
}

// ==========================================
// EVENTOS WEBSOCKET (SOCKET.IO)
// ==========================================

export interface WsBarTicketPrintEvent {
  ticket: PickupTicketDto;
  barId: string;
  timestamp: string;
}

export interface WsTicketStatusChangeEvent {
  ticketId: string;
  status: TicketStatus;
  shortCode: string;
  securityColor: string;
  barId: string;
  readyAt?: string;
  deliveredAt?: string;
}

export interface WsBarQueueUpdateEvent {
  barId: string;
  activeCount: number;
  queuedCount: number;
  estimatedWaitMinutes: number;
}

export interface WsStockToggleEvent {
  productId: string;
  tenantId: string;
  isAvailable: boolean;
}

export interface WsOrderPaymentEvent {
  orderId: string;
  userId: string;
  tenantId: string;
  paymentStatus: OrderStatus;
  totalAmount: number;
  platformFee: number;
  gatewayFee: number;
  tenantNetAmount: number;
  mpPaymentId?: string;
  timestamp: string;
}
