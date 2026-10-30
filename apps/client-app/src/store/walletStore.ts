import { create } from 'zustand';

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
  barName: string;
  items: Array<{ name: string; quantity: number }>;
  activatedAt: string;
}

interface WalletState {
  drinks: WalletItem[];
  activeTicket: OfflineSavedTicket | null;
  setDrinks: (drinks: WalletItem[]) => void;
  setActiveTicket: (ticket: OfflineSavedTicket | null) => void;
  redeemDrinkLocally: (orderItemId: string, qty: number) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
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
  setDrinks: (drinks) => set({ drinks }),
  setActiveTicket: (activeTicket) => {
    set({ activeTicket });
    // Persistencia offline-first en localStorage si corre en web/PWA
    if (typeof window !== 'undefined' && activeTicket) {
      localStorage.setItem('tutrago_active_ticket', JSON.stringify(activeTicket));
    }
  },
  redeemDrinkLocally: (orderItemId, qty) =>
    set((state) => ({
      drinks: state.drinks
        .map((d) => (d.orderItemId === orderItemId ? { ...d, quantityRemaining: d.quantityRemaining - qty } : d))
        .filter((d) => d.quantityRemaining > 0),
    })),
}));
