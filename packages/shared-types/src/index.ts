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
  paymentStatus: OrderStatus;
  mpPreferenceId?: string;
  mpPaymentId?: string;
  items: OrderItemDto[];
  createdAt: Date;
  updatedAt: Date;
}

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
