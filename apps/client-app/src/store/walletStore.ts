import { create } from 'zustand';

export const DEFAULT_CLIENT_USER_ID = '00000000-0000-4000-8000-000000000201';
export const DEFAULT_CLIENT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export interface WalletItem {
  orderItemId: string;
  orderId: string;
  productId: string;
  productName: string;
  category: string;
  unitPrice: number;
  quantityRemaining: number;
}

export interface OfflineSavedTicket {
  ticketId: string;
  shortCode: string;
  securityColor: string;
  status: 'PREP_REQUESTED' | 'IN_PREPARATION' | 'READY_FOR_PICKUP' | 'DELIVERED';
  offlineQrToken: string;
  barId?: string;
  barName: string;
  items: Array<{ name: string; quantity: number }>;
  activatedAt: string;
  readyAt?: string;
  deliveredAt?: string;
}

export interface OrderSplitSummary {
  orderId: string;
  mpPaymentId?: string;
  paymentStatus: 'CREATED' | 'PENDING_PAYMENT' | 'PAID_ON_HOLD' | 'CANCELLED_REFUNDED';
  totalAmount: number;
  platformFee: number;
  gatewayFee: number;
  tenantNetAmount: number;
  appliedCommissionPct: number;
  appliedGatewayFeePct: number;
}

export interface ConsumerSessionUser {
  id: string;
  fullName: string;
  authMethod: 'GUEST' | 'GOOGLE' | 'APPLE' | 'OTP';
  contact?: string;
  token?: string;
}

export interface VenueContextState {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  selectedBarId: string;
}

export interface VenueBarOption {
  id: string;
  name: string;
  wait: string;
  tag: string;
}

export function createOfflineJwtSimulation(input: {
  ticketId: string;
  shortCode: string;
  barId: string;
  securityColor: string;
  items: Array<{ name: string; quantity: number }>;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: 'tutrago-offline-sim' };
  const payload = {
    ticketId: input.ticketId,
    shortCode: input.shortCode,
    barId: input.barId,
    securityColor: input.securityColor,
    items: input.items,
    iat: nowSec,
    exp: nowSec + 12 * 3600,
    jti: `offline-${input.ticketId}-${nowSec}`,
  };
  const encodePart = (obj: unknown) => {
    const json = JSON.stringify(obj);
    if (typeof btoa === 'function') {
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    }
    return encodeURIComponent(json);
  };
  return `${encodePart(header)}.${encodePart(payload)}.offline-local-sig-${input.shortCode}`;
}

export function getConsumerAuthHeaders(
  extraHeaders: Record<string, string> = {},
  options?: { userId?: string; token?: string; pilotPin?: string }
): Record<string, string> {
  const state = useWalletStore.getState();
  const resolvedUserId = options?.userId || state.user?.id || DEFAULT_CLIENT_USER_ID;
  const resolvedToken = options?.token || state.user?.token;

  return {
    ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
    'X-User-Id': resolvedUserId,
    'X-Tenant-Id': state.venue?.tenantId || DEFAULT_CLIENT_TENANT_ID,
    ...(options?.pilotPin ? { 'X-Pilot-Pin': options.pilotPin } : {}),
    ...extraHeaders,
  };
}

export async function ensureConsumerJwtSession(apiUrl: string): Promise<string | undefined> {
  const state = useWalletStore.getState();
  if (state.user?.token && state.user.token.split('.').length === 3) {
    return state.user.token;
  }

  const userId = state.user?.id || DEFAULT_CLIENT_USER_ID;
  try {
    const res = await fetch(`${apiUrl}/tenants/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        tenantId: state.venue?.tenantId || DEFAULT_CLIENT_TENANT_ID,
        name: state.user?.fullName || 'Invitado Club',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.token) {
        useWalletStore.setState((prev) => ({
          user: {
            id: userId,
            fullName: prev.user?.fullName || 'Invitado Club',
            authMethod: prev.user?.authMethod || 'GUEST',
            contact: prev.user?.contact,
            token: data.token,
          },
        }));
        return data.token;
      }
    }
  } catch {
    // Fallback offline-first
  }
  return state.user?.token;
}

const DEFAULT_BARS: VenueBarOption[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Barra Pista Central',
    wait: '~3 min',
    tag: 'Más cercana',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'Barra Terraza VIP',
    wait: '~1 min',
    tag: 'Rápida',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Barra Patio Electrónica',
    wait: '~2 min',
    tag: 'Patio',
  },
];

interface WalletState {
  user: ConsumerSessionUser | null;
  venue: VenueContextState;
  bars: VenueBarOption[];
  drinks: WalletItem[];
  activeTicket: OfflineSavedTicket | null;
  ticketHistory: OfflineSavedTicket[];
  lastOrderSummary: OrderSplitSummary | null;
  pilotSandboxMode: boolean;
  hydrateFromStorage: () => void;
  setVenueContext: (partial: Partial<VenueContextState>) => void;
  loginWithOAuth: (provider: 'GOOGLE' | 'APPLE') => void;
  loginWithOtp: (contact: string) => void;
  loginAsGuest: () => void;
  setDrinks: (drinks: WalletItem[]) => void;
  addDrinksFromOrder: (newDrinks: WalletItem[], summary?: OrderSplitSummary) => void;
  revokeOrderDrinksLocally: (orderId: string) => void;
  setActiveTicket: (ticket: OfflineSavedTicket | null) => void;
  updateActiveTicketStatus: (status: OfflineSavedTicket['status']) => void;
  setLastOrderSummary: (summary: OrderSplitSummary | null) => void;
  setPilotSandboxMode: (enabled: boolean) => void;
  redeemDrinkLocally: (orderItemId: string, qty: number) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  user: {
    id: DEFAULT_CLIENT_USER_ID,
    fullName: 'Invitado Pista VIP',
    authMethod: 'GUEST',
  },
  venue: {
    tenantId: DEFAULT_CLIENT_TENANT_ID,
    tenantSlug: 'club-tutrago',
    tenantName: 'Club Nocturno Tutrago Central',
    selectedBarId: '00000000-0000-4000-8000-000000000101',
  },
  bars: DEFAULT_BARS,
  drinks: [
    {
      orderItemId: '00000000-0000-4000-8000-000000000301',
      orderId: '00000000-0000-4000-8000-000000000201',
      productId: 'p-fernet',
      productName: 'Fernet Branca con Coca-Cola',
      category: 'Tragos Clásicos',
      unitPrice: 9500,
      quantityRemaining: 2, // 2 Fernets listos para canjear en la noche
    },
    {
      orderItemId: '00000000-0000-4000-8000-000000000302',
      orderId: '00000000-0000-4000-8000-000000000201',
      productId: 'p-gin',
      productName: 'Gin Tonic Nacional',
      category: 'Gin & Cocktails',
      unitPrice: 8500,
      quantityRemaining: 1, // 1 Gin Tonic
    },
  ],
  activeTicket: null,
  ticketHistory: [],
  lastOrderSummary: null,
  pilotSandboxMode: true,
  hydrateFromStorage: () => {
    if (typeof window === 'undefined') return;
    try {
      const savedTicketRaw = localStorage.getItem('tutrago_active_ticket');
      if (savedTicketRaw) {
        const parsedTicket = JSON.parse(savedTicketRaw) as OfflineSavedTicket;
        set({
          activeTicket: parsedTicket,
          ticketHistory: [parsedTicket],
        });
      }
      const savedUserRaw = localStorage.getItem('tutrago_consumer_user');
      if (savedUserRaw) {
        set({ user: JSON.parse(savedUserRaw) as ConsumerSessionUser });
      }
    } catch {
      // ignore storage errors
    }
  },
  setVenueContext: (partial) =>
    set((state) => ({
      venue: { ...state.venue, ...partial },
    })),
  loginWithOAuth: (provider) =>
    set((state) => {
      const nextUser: ConsumerSessionUser = {
        id: state.user?.id || DEFAULT_CLIENT_USER_ID,
        fullName: provider === 'GOOGLE' ? 'Usuario Google VIP' : 'Usuario Apple ID',
        authMethod: provider,
        token: state.user?.token,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('tutrago_consumer_user', JSON.stringify(nextUser));
      }
      return { user: nextUser };
    }),
  loginWithOtp: (contact) =>
    set((state) => {
      const nextUser: ConsumerSessionUser = {
        id: state.user?.id || DEFAULT_CLIENT_USER_ID,
        fullName: `Cliente Verificado (${contact.slice(-4)})`,
        authMethod: 'OTP',
        contact,
        token: state.user?.token,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('tutrago_consumer_user', JSON.stringify(nextUser));
      }
      return { user: nextUser };
    }),
  loginAsGuest: () =>
    set((state) => {
      const nextUser: ConsumerSessionUser = {
        id: state.user?.id || DEFAULT_CLIENT_USER_ID,
        fullName: 'Invitado Pista VIP',
        authMethod: 'GUEST',
        token: state.user?.token,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('tutrago_consumer_user', JSON.stringify(nextUser));
      }
      return { user: nextUser };
    }),
  setDrinks: (drinks) => set({ drinks }),
  addDrinksFromOrder: (newDrinks, summary) =>
    set((state) => {
      const existingIds = new Set(newDrinks.map((d) => d.orderItemId));
      const filtered = state.drinks.filter((d) => !existingIds.has(d.orderItemId));
      return {
        drinks: [...newDrinks, ...filtered],
        ...(summary ? { lastOrderSummary: summary } : {}),
      };
    }),
  revokeOrderDrinksLocally: (orderId) =>
    set((state) => ({
      drinks: state.drinks.filter((d) => d.orderId !== orderId),
      lastOrderSummary:
        state.lastOrderSummary?.orderId === orderId
          ? { ...state.lastOrderSummary, paymentStatus: 'CANCELLED_REFUNDED' }
          : state.lastOrderSummary,
    })),
  setActiveTicket: (activeTicket) => {
    set((state) => {
      const historyWithoutCurrent = activeTicket
        ? state.ticketHistory.filter((t) => t.ticketId !== activeTicket.ticketId)
        : state.ticketHistory;
      return {
        activeTicket,
        ticketHistory: activeTicket ? [activeTicket, ...historyWithoutCurrent] : state.ticketHistory,
      };
    });
    // Persistencia offline-first en localStorage si corre en web/PWA
    if (typeof window !== 'undefined' && activeTicket) {
      localStorage.setItem('tutrago_active_ticket', JSON.stringify(activeTicket));
    }
  },
  updateActiveTicketStatus: (status) =>
    set((state) => {
      if (!state.activeTicket) return {};
      const updated: OfflineSavedTicket = {
        ...state.activeTicket,
        status,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('tutrago_active_ticket', JSON.stringify(updated));
      }
      return {
        activeTicket: updated,
        ticketHistory: state.ticketHistory.map((t) =>
          t.ticketId === updated.ticketId ? updated : t
        ),
      };
    }),
  setLastOrderSummary: (lastOrderSummary) => set({ lastOrderSummary }),
  setPilotSandboxMode: (pilotSandboxMode) => set({ pilotSandboxMode }),
  redeemDrinkLocally: (orderItemId, qty) =>
    set((state) => ({
      drinks: state.drinks
        .map((d) =>
          d.orderItemId === orderItemId ? { ...d, quantityRemaining: d.quantityRemaining - qty } : d
        )
        .filter((d) => d.quantityRemaining > 0),
    })),
}));
