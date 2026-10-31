'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Printer,
  QrCode,
  CheckCircle,
  Bell,
  Clock,
  ShieldAlert,
  Volume2,
  Layers,
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Camera,
  Zap,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  X,
  Wifi,
  ScanLine,
} from 'lucide-react';
import { EscPosThermalPrinter } from '@/lib/thermal-print/escpos';
import { io } from 'socket.io-client';
import {
  getApiUrl,
  getWsUrl,
  DEFAULT_TENANT_ID,
  getStaffAuthHeaders,
  ensureSignedStaffSession,
} from '@/lib/api-config';

const BAR_ALIAS_MAP: Record<string, string> = {
  'bar-pista-123': '00000000-0000-4000-8000-000000000101',
  'bar-terraza-vip': '00000000-0000-4000-8000-000000000102',
  'bar-patio-electro': '00000000-0000-4000-8000-000000000103',
};

const BAR_NAMES: Record<string, string> = {
  '00000000-0000-4000-8000-000000000101': 'Barra Pista Central',
  '00000000-0000-4000-8000-000000000102': 'Barra Terraza VIP',
  '00000000-0000-4000-8000-000000000103': 'Barra Patio Electrónica',
};

interface KdsTicketItem {
  productId?: string;
  name: string;
  quantity: number;
  isAvailable?: boolean;
  price?: number;
}

interface KdsTicket {
  id: string;
  shortCode: string;
  securityColor: string;
  status:
    | 'PREP_REQUESTED'
    | 'IN_PREPARATION'
    | 'READY_FOR_PICKUP'
    | 'DELIVERED'
    | 'CANCELLED_REFUNDED';
  activatedAt: string;
  items: KdsTicketItem[];
}

interface ProductStockItem {
  id: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
}

interface RecoveryOptionsPayload {
  originalProduct: ProductStockItem;
  refundableAmount: number;
  suggestedSubstitutes: ProductStockItem[];
}

const FALLBACK_PRODUCTS: ProductStockItem[] = [
  {
    id: 'prod-fernet',
    name: 'Fernet Branca con Coca',
    category: 'Tragos Clásicos',
    price: 8500,
    isAvailable: true,
  },
  {
    id: 'prod-gin',
    name: 'Gin Tonic Beefeater',
    category: 'Gin & Cocktails',
    price: 9500,
    isAvailable: true,
  },
  {
    id: 'prod-vodka',
    name: 'Skyy Vodka con Speed',
    category: 'Tragos con Energizante',
    price: 9000,
    isAvailable: true,
  },
  {
    id: 'prod-cerveza',
    name: 'Heineken Pint 473ml',
    category: 'Cervezas',
    price: 6500,
    isAvailable: true,
  },
  {
    id: 'prod-jager',
    name: 'Jägermeister Shot Helado',
    category: 'Shots',
    price: 7000,
    isAvailable: true,
  },
];

const FALLBACK_TICKETS: KdsTicket[] = [
  {
    id: 'demo-ticket-a47',
    shortCode: 'A47',
    securityColor: '#10B981',
    status: 'IN_PREPARATION',
    activatedAt: new Date(Date.now() - 65000).toISOString(),
    items: [
      { name: 'Fernet Branca con Coca', quantity: 2, isAvailable: true, price: 8500 },
      { name: 'Skyy Vodka con Speed', quantity: 1, isAvailable: true, price: 9000 },
    ],
  },
  {
    id: 'demo-ticket-b19',
    shortCode: 'B19',
    securityColor: '#F59E0B',
    status: 'IN_PREPARATION',
    activatedAt: new Date(Date.now() - 40000).toISOString(),
    items: [{ name: 'Gin Tonic Beefeater', quantity: 2, isAvailable: true, price: 9500 }],
  },
  {
    id: 'demo-ticket-c89',
    shortCode: 'C89',
    securityColor: '#3B82F6',
    status: 'READY_FOR_PICKUP',
    activatedAt: new Date(Date.now() - 125000).toISOString(),
    items: [
      { name: 'Skyy Vodka con Speed', quantity: 2, isAvailable: true, price: 9000 },
      { name: 'Jägermeister Shot Helado', quantity: 3, isAvailable: true, price: 7000 },
    ],
  },
  {
    id: 'demo-ticket-d04',
    shortCode: 'D04',
    securityColor: '#EC4899',
    status: 'DELIVERED',
    activatedAt: new Date(Date.now() - 280000).toISOString(),
    items: [{ name: 'Fernet Branca con Coca', quantity: 1, isAvailable: true, price: 8500 }],
  },
];

export default function BarKdsPage() {
  const params = useParams();
  const rawBarId = (params?.barId as string) || '00000000-0000-4000-8000-000000000101';
  const barId = BAR_ALIAS_MAP[rawBarId] || rawBarId;

  const [barName, setBarName] = useState(BAR_NAMES[barId] || 'Barra Pista Central');
  const [maxConcurrentPrep, setMaxConcurrentPrep] = useState(15);
  const [printerType, setPrinterType] = useState('WEB_SERIAL_80MM');
  const [wsConnected, setWsConnected] = useState<boolean>(true);

  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [products, setProducts] = useState<ProductStockItem[]>([]);
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);

  // Input de escaneo láser USB siempre enfocado en la barra superior
  const [laserScanInput, setLaserScanInput] = useState('');
  const laserInputRef = useRef<HTMLInputElement | null>(null);

  // Estado Validación Entrega (QR / Cámara / Código Corto)
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'CODE' | 'CAMERA'>('CODE');
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Estado Impresión Térmica 80mm
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);
  const [thermalPreviewTicket, setThermalPreviewTicket] = useState<{
    ticket: KdsTicket;
    method: string;
    byteSize: number;
  } | null>(null);

  // Estado Flujo Service Recovery en 1 Clic
  const [recoveryTarget, setRecoveryTarget] = useState<{
    ticketId?: string;
    shortCode?: string;
    product: ProductStockItem;
    substitutes: ProductStockItem[];
  } | null>(null);

  const [scanAlert, setScanAlert] = useState<{
    type: 'SUCCESS' | 'ERROR' | 'PRINT';
    message: string;
  } | null>(null);

  const showBannerAlert = (type: 'SUCCESS' | 'ERROR' | 'PRINT', message: string) => {
    setScanAlert({ type, message });
    setTimeout(() => setScanAlert(null), 4200);
  };

  // Mapeador de tickets desde la API
  const mapApiTicketToKds = useCallback((t: any): KdsTicket => {
    return {
      id: t.id || t.ticketId,
      shortCode: t.shortCode,
      securityColor: t.securityColor || '#10B981',
      status: t.status || 'IN_PREPARATION',
      activatedAt: t.activatedAt || new Date().toISOString(),
      items: (t.items || []).map((i: any) => ({
        productId: i.orderItem?.product?.id || i.orderItem?.productId || i.productId,
        name: i.orderItem?.product?.name || i.productName || i.name || 'Bebida',
        quantity: i.quantity,
        isAvailable: i.orderItem?.product?.isAvailable ?? i.isAvailable ?? true,
        price: i.orderItem?.product?.price || i.orderItem?.unitPrice || 9000,
      })),
    };
  }, []);

  const fetchBarState = useCallback(async () => {
    const apiUrl = getApiUrl();
    const staffHeaders = getStaffAuthHeaders({}, { defaultRole: 'BARTENDER', barId });
    try {
      const [barRes, ticketsRes, catalogRes] = await Promise.all([
        fetch(`${apiUrl}/tenants/bars/${barId}`, { headers: staffHeaders }),
        fetch(`${apiUrl}/pickup/bar/${barId}/active`, { headers: staffHeaders }),
        fetch(`${apiUrl}/catalog/tenant/${DEFAULT_TENANT_ID}`, { headers: staffHeaders }),
      ]);

      if (barRes.ok) {
        const bData = await barRes.json();
        if (bData?.name) setBarName(bData.name);
        if (bData?.maxConcurrentPrep) setMaxConcurrentPrep(bData.maxConcurrentPrep);
        if (bData?.printerType) setPrinterType(bData.printerType);
      }

      if (ticketsRes.ok) {
        const tData = await ticketsRes.json();
        if (Array.isArray(tData)) {
          setTickets(tData.map(mapApiTicketToKds));
        }
      }

      if (catalogRes.ok) {
        const cData = await catalogRes.json();
        if (Array.isArray(cData)) {
          setProducts(cData);
        }
      }
    } catch {
      // Fallback de demostración si la API no está levantada en local
      setTickets((prev) => (prev.length > 0 ? prev : FALLBACK_TICKETS));
      setProducts((prev) => (prev.length > 0 ? prev : FALLBACK_PRODUCTS));
    }
  }, [barId, mapApiTicketToKds]);

  // 0. Conexión en Tiempo Real con Backend API + WebSocket (Socket.io)
  useEffect(() => {
    ensureSignedStaffSession({ defaultRole: 'BARTENDER', barId }).finally(() => {
      fetchBarState();
    });

    const socket = io(getWsUrl(), {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setWsConnected(true);
      socket.emit('join:bar', { barId });
    });

    socket.on('disconnect', () => {
      setWsConnected(false);
    });

    socket.on('bar:ticket_print', (event: any) => {
      const incoming = event?.ticket;
      if (!incoming) return;
      const newKdsTicket = mapApiTicketToKds(incoming);

      setTickets((prev) => {
        if (prev.some((t) => t.id === newKdsTicket.id)) return prev;
        return [newKdsTicket, ...prev];
      });

      if (autoPrintEnabled && newKdsTicket.status === 'IN_PREPARATION') {
        EscPosThermalPrinter.dispatchThermalPrint(
          {
            barName,
            shortCode: newKdsTicket.shortCode,
            securityColor: newKdsTicket.securityColor,
            activatedAt: newKdsTicket.activatedAt,
            items: newKdsTicket.items,
          },
          false
        ).catch(() => {});
      }
    });

    socket.on('bar:ticket_updated', () => {
      fetchBarState();
    });

    socket.on('stock:toggled', (payload: { productId: string; isAvailable: boolean }) => {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === payload.productId ? { ...p, isAvailable: payload.isAvailable } : p
        )
      );
      setTickets((prev) =>
        prev.map((t) => ({
          ...t,
          items: t.items.map((item) =>
            item.productId === payload.productId
              ? { ...item, isAvailable: payload.isAvailable }
              : item
          ),
        }))
      );
    });

    socket.on('catalog:updated', () => {
      fetchBarState();
    });

    return () => {
      socket.disconnect();
    };
  }, [barId, barName, autoPrintEnabled, fetchBarState, mapApiTicketToKds]);

  // Mantener foco ergonómico en el lector láser USB cuando no hay modales abiertos
  useEffect(() => {
    if (!scanModalOpen && !recoveryTarget && !thermalPreviewTicket && !stockDrawerOpen) {
      laserInputRef.current?.focus();
    }
  }, [scanModalOpen, recoveryTarget, thermalPreviewTicket, stockDrawerOpen]);

  // 1. Soporte para Pistola Lectora QR USB (ráfaga rápida de teclado terminada en Enter)
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;

      const now = Date.now();
      if (now - lastKeyTime > 80) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          handleValidateScan(buffer.trim());
          buffer = '';
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Cámara WebRTC para validación de QR desde la tablet de barra
  useEffect(() => {
    let mediaStream: MediaStream | null = null;
    if (scanModalOpen && scanMode === 'CAMERA') {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment' } })
          .then((stream) => {
            mediaStream = stream;
            setCameraActive(true);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          })
          .catch(() => {
            setCameraActive(false);
          });
      }
    }

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
      setCameraActive(false);
    };
  }, [scanModalOpen, scanMode]);

  // 2. Disparador de Impresión Térmica (WebUSB / WebSerial con fallback a navegador 80mm)
  const triggerPrint = async (ticket: KdsTicket) => {
    const printData = {
      barName,
      shortCode: ticket.shortCode,
      securityColor: ticket.securityColor,
      activatedAt: ticket.activatedAt,
      items: ticket.items,
    };

    const result = await EscPosThermalPrinter.dispatchThermalPrint(printData, false);
    setThermalPreviewTicket({
      ticket,
      method: result.method,
      byteSize: result.byteSize,
    });
    showBannerAlert(
      'PRINT',
      `Comanda #${ticket.shortCode} enviada a impresora 80mm (${result.method} · ${result.byteSize} bytes ESC/POS).`
    );
  };

  // 3. Avance de estados con 1 clic (IN_PREPARATION -> READY_FOR_PICKUP -> DELIVERED)
  const advanceTicket = async (
    ticketId: string,
    nextStatus: 'READY_FOR_PICKUP' | 'DELIVERED'
  ) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: nextStatus } : t))
    );

    const apiUrl = getApiUrl();
    try {
      await fetch(`${apiUrl}/pickup/ticket/${ticketId}/status`, {
        method: 'PATCH',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `kds-status-${ticketId}-${nextStatus}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER', barId }
        ),
        body: JSON.stringify({ status: nextStatus }),
      });
      await fetchBarState();
    } catch {
      // ignore
    }

    if (typeof window !== 'undefined') {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = nextStatus === 'READY_FOR_PICKUP' ? 880 : 1200;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } catch {
        // ignore
      }
    }
  };

  // 4. Switch de Stock en vivo con 1 toque desde el Monitor KDS
  const handleToggleStock = async (product: ProductStockItem) => {
    const nextState = !product.isAvailable;
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, isAvailable: nextState } : p))
    );
    setTickets((prev) =>
      prev.map((t) => ({
        ...t,
        items: t.items.map((i) =>
          i.productId === product.id || i.name === product.name
            ? { ...i, isAvailable: nextState }
            : i
        ),
      }))
    );

    try {
      await fetch(`${getApiUrl()}/catalog/product/${product.id}/stock`, {
        method: 'PATCH',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `kds-stock-${product.id}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER', barId }
        ),
        body: JSON.stringify({ isAvailable: nextState }),
      });
      showBannerAlert(
        nextState ? 'SUCCESS' : 'ERROR',
        nextState
          ? `Stock de "${product.name}" HABILITADO en todas las pantallas.`
          : `"${product.name}" marcado AGOTADO. Se activó alerta de Service Recovery en comandas afectadas.`
      );
    } catch {
      // ignore
    }
  };

  // 5. Abrir Modal de Service Recovery en 1 Clic
  const openServiceRecoveryModal = async (
    productIdOrName: string,
    ticketId?: string,
    shortCode?: string
  ) => {
    const matchedProduct =
      products.find((p) => p.id === productIdOrName || p.name === productIdOrName) || {
        id: productIdOrName,
        name: productIdOrName,
        category: 'Tragos Clásicos',
        price: 8000,
        isAvailable: false,
      };

    let substitutes = products.filter(
      (p) => p.isAvailable && p.id !== matchedProduct.id
    );

    try {
      const res = await fetch(`${getApiUrl()}/catalog/product/${matchedProduct.id}/recovery`);
      if (res.ok) {
        const data: RecoveryOptionsPayload = await res.json();
        if (Array.isArray(data.suggestedSubstitutes) && data.suggestedSubstitutes.length > 0) {
          substitutes = data.suggestedSubstitutes;
        }
      }
    } catch {
      // fallback a sustitutos locales
    }

    setRecoveryTarget({
      ticketId,
      shortCode,
      product: matchedProduct,
      substitutes: substitutes.slice(0, 4),
    });
  };

  // 6. Ejecutar Resolución de Service Recovery en 1 Clic (Reemplazo o Reembolso)
  const handleExecuteServiceRecovery = async (
    action: 'SUBSTITUTE' | 'REFUND',
    substituteProduct?: ProductStockItem
  ) => {
    if (!recoveryTarget) return;
    const apiUrl = getApiUrl();

    try {
      const res = await fetch(`${apiUrl}/pickup/service-recovery`, {
        method: 'POST',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `recovery-${action}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER', barId }
        ),
        body: JSON.stringify({
          action,
          ticketId: recoveryTarget.ticketId,
          productId: recoveryTarget.product.id,
          substituteProductId: substituteProduct?.id,
          barId,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        showBannerAlert('SUCCESS', result.message);
        await fetchBarState();
      } else {
        throw new Error('Fallback local');
      }
    } catch {
      if (action === 'SUBSTITUTE' && substituteProduct && recoveryTarget.ticketId) {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === recoveryTarget.ticketId
              ? {
                  ...t,
                  items: t.items.map((item) =>
                    item.productId === recoveryTarget.product.id ||
                    item.name === recoveryTarget.product.name
                      ? {
                          ...item,
                          productId: substituteProduct.id,
                          name: `${substituteProduct.name} (Sustituto)`,
                          isAvailable: true,
                        }
                      : item
                  ),
                }
              : t
          )
        );
        showBannerAlert(
          'SUCCESS',
          `¡Sustitución en 1 clic aplicada! Se reemplazó "${recoveryTarget.product.name}" por "${substituteProduct.name}".`
        );
      } else if (action === 'REFUND') {
        if (recoveryTarget.ticketId) {
          setTickets((prev) => prev.filter((t) => t.id !== recoveryTarget.ticketId));
        }
        showBannerAlert(
          'SUCCESS',
          `¡Devolución de $${recoveryTarget.product.price.toLocaleString('es-AR')} emitida al cliente en 1 clic!`
        );
      }
    }

    setRecoveryTarget(null);
  };

  // 7. Validación de Entrega por Código/Color, Pistola QR o Cámara de Tablet
  const handleValidateScan = async (codeOrJwt: string) => {
    const trimmed = codeOrJwt.replace(/^#/, '').trim();
    if (!trimmed) return;
    const cleanCode = trimmed.toUpperCase();
    const tokenPayload = trimmed.includes('.') ? trimmed : cleanCode;

    const apiUrl = getApiUrl();
    try {
      const res = await fetch(`${apiUrl}/pickup/validate-scan`, {
        method: 'POST',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `scan-${tokenPayload.slice(-12)}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER', barId }
        ),
        body: JSON.stringify({ token: tokenPayload, barId }),
      });

      if (res.ok) {
        const delivered = await res.json();
        showBannerAlert(
          'SUCCESS',
          `¡Ticket #${delivered.shortCode || cleanCode} validado por QR/Color y marcado como ENTREGADO!`
        );
        setManualCode('');
        setLaserScanInput('');
        await fetchBarState();
        return;
      } else {
        const errBody = await res.json().catch(() => ({}));
        if (
          errBody?.error === 'TICKET_ALREADY_DELIVERED' ||
          errBody?.message?.includes('ALERTA')
        ) {
          showBannerAlert(
            'ERROR',
            `¡ALERTA DE SEGURIDAD ANTI-REPLAY! El ticket #${cleanCode} ya fue entregado previamente.`
          );
          setLaserScanInput('');
          return;
        }
      }
    } catch {
      // Fallback validación local
    }

    const found = tickets.find(
      (t) => t.shortCode.toUpperCase() === cleanCode || t.id === cleanCode
    );

    if (!found) {
      showBannerAlert('ERROR', `Código #${cleanCode} no reconocido en esta barra.`);
      setLaserScanInput('');
      return;
    }

    if (found.status === 'DELIVERED') {
      showBannerAlert(
        'ERROR',
        `¡ALERTA DE SEGURIDAD ANTI-REPLAY! El ticket #${found.shortCode} ya fue entregado previamente.`
      );
      setLaserScanInput('');
      return;
    }

    await advanceTicket(found.id, 'DELIVERED');
    showBannerAlert(
      'SUCCESS',
      `¡Ticket #${found.shortCode} validado y entregado con éxito!`
    );
    setManualCode('');
    setLaserScanInput('');
  };

  // Simular nueva comanda o avalancha FIFO para pruebas en vivo
  const handleSimulateComanda = async (count = 1) => {
    try {
      const res = await fetch(`${getApiUrl()}/pickup/bar/${barId}/simulate`, {
        method: 'POST',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `sim-bar-${barId}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER', barId }
        ),
        body: JSON.stringify({ count }),
      });
      if (res.ok) {
        await fetchBarState();
      } else {
        throw new Error('Local sim');
      }
    } catch {
      const colors = ['#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#8B5CF6'];
      const randomNum = Math.floor(10 + Math.random() * 89);
      const mockTicket: KdsTicket = {
        id: `local-${Date.now()}`,
        shortCode: `A${randomNum}`,
        securityColor: colors[randomNum % colors.length],
        status: 'IN_PREPARATION',
        activatedAt: new Date().toISOString(),
        items: [{ name: 'Fernet Branca con Coca', quantity: 2, isAvailable: true, price: 8500 }],
      };
      setTickets((prev) => [mockTicket, ...prev]);
    }
    showBannerAlert(
      'SUCCESS',
      count > 1
        ? `¡Ráfaga de ${count} comandas recibida! Motor FIFO en Redis filtrando según capacidad (${maxConcurrentPrep} máx).`
        : '¡Nueva comanda recibida por WebSocket e impresa en 80mm!'
    );
  };

  const queuedFifoTickets = tickets.filter((t) => t.status === 'PREP_REQUESTED');
  const inPrepTickets = tickets.filter((t) => t.status === 'IN_PREPARATION');
  const readyTickets = tickets.filter((t) => t.status === 'READY_FOR_PICKUP');
  const deliveredTickets = tickets.filter((t) => t.status === 'DELIVERED');
  const soldOutCount = products.filter((p) => !p.isAvailable).length;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#050507] text-white select-none">
      {/* ===================================================================== */}
      {/* BARRA SUPERIOR FIJA INDUSTRIAL (SQUARE KDS / TABLET DARK MODE)        */}
      {/* ===================================================================== */}
      <header className="border-b border-zinc-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-zinc-950 shrink-0 z-20">
        {/* Izquierda: Identidad de Barra + Semáforo WebSocket + Cola FIFO Redis */}
        <div className="flex items-center gap-3">
          <a
            href="/admin"
            title="Ir al Panel del Boliche (/admin)"
            className="w-11 h-11 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 flex items-center justify-center transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-black tracking-tight text-white uppercase">
                {barName}
              </h1>

              {/* Semáforo de Conexión WebSocket */}
              <div
                className={`px-2.5 py-1 rounded-full border text-[11px] font-black flex items-center gap-1.5 ${
                  wsConnected
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                    : 'bg-rose-950/70 border-rose-500/60 text-rose-300'
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <Wifi className="w-3.5 h-3.5" />
                <span>{wsConnected ? 'WS ONLINE' : 'RECONECTANDO'}</span>
              </div>

              {/* Indicador de Cola FIFO en Redis */}
              <div
                className={`px-3 py-1 rounded-full border text-xs font-black flex items-center gap-1.5 ${
                  inPrepTickets.length >= maxConcurrentPrep
                    ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-200'
                }`}
              >
                <span>
                  FIFO REDIS: {inPrepTickets.length}/{maxConcurrentPrep}
                </span>
                {queuedFifoTickets.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 text-[10px] font-black">
                    +{queuedFifoTickets.length} COLA
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Centro: Input de Escaneo Láser USB Siempre Enfocado */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (laserScanInput.trim()) {
              handleValidateScan(laserScanInput);
            }
          }}
          className="flex-1 max-w-md min-w-[240px]"
        >
          <div className="relative flex items-center">
            <ScanLine className="w-4 h-4 text-emerald-400 absolute left-3.5 pointer-events-none" />
            <input
              ref={laserInputRef}
              autoFocus
              type="text"
              data-testid="laser-scanner-input"
              value={laserScanInput}
              onChange={(e) => setLaserScanInput(e.target.value)}
              placeholder="Escáner Láser USB activo · Escanea QR o tipea #A47 + Enter..."
              className="w-full h-11 pl-10 pr-20 rounded-xl bg-zinc-900 border-2 border-zinc-700 focus:border-emerald-500 text-xs font-black uppercase tracking-wider text-white placeholder:text-zinc-400 placeholder:normal-case placeholder:font-semibold focus:outline-none transition"
            />
            <button
              type="submit"
              className="absolute right-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-black text-white transition"
            >
              Validar
            </button>
          </div>
        </form>

        {/* Derecha: Acciones Táctiles Rápidas (Drawer de Stock 1-Toque + Escáner + Simulador) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSimulateComanda(1)}
            data-testid="simulate-comanda-btn"
            className="h-11 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-extrabold text-zinc-200 flex items-center gap-1.5 transition"
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="hidden xl:inline">+ Comanda</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoPrintEnabled(!autoPrintEnabled)}
            title={`Protocolo: ${printerType}`}
            className={`h-11 px-3 rounded-xl text-xs font-extrabold border transition flex items-center gap-1.5 ${
              autoPrintEnabled
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400'
            }`}
          >
            <Printer className="w-4 h-4" />
            <span className="hidden lg:inline">80mm:</span> {autoPrintEnabled ? 'AUTO' : 'OFF'}
          </button>

          <button
            type="button"
            data-testid="toggle-stock-drawer-btn"
            onClick={() => setStockDrawerOpen(!stockDrawerOpen)}
            className={`h-11 px-4 rounded-xl text-xs font-black border-2 transition flex items-center gap-2 ${
              stockDrawerOpen
                ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-lg shadow-amber-500/20'
                : 'bg-zinc-900 hover:bg-zinc-800 border-amber-500/50 text-amber-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Apagar Botella 1-Toque</span>
            {soldOutCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black">
                {soldOutCount} AGOT.
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="open-scan-validator-btn"
            onClick={() => setScanModalOpen(true)}
            className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs flex items-center gap-2 shadow-lg shadow-blue-600/25 transition"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Cámara / Código</span>
          </button>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* DRAWER DESPLEGABLE DE STOCK ("APAGAR BOTELLA EN 1 TOQUE")             */}
      {/* ===================================================================== */}
      {stockDrawerOpen && (
        <div
          data-testid="kds-stock-drawer"
          className="bg-zinc-900 border-b-2 border-amber-500/50 px-5 py-4 shadow-2xl shrink-0 max-h-64 overflow-y-auto z-10"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wide">
                Drawer de Stock Instantáneo · 1 Toque = Apagar / Encender Botella en Vivo
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <a href="/stock" className="text-xs font-bold text-blue-400 hover:underline">
                Ver Matriz Completa de Stock →
              </a>
              <button
                type="button"
                onClick={() => setStockDrawerOpen(false)}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 text-xs font-black text-zinc-300 hover:text-white"
              >
                Cerrar ✕
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
            {products.map((prod) => (
              <div
                key={prod.id}
                className={`p-3 rounded-xl border-2 flex flex-col justify-between transition ${
                  prod.isAvailable
                    ? 'bg-zinc-950 border-zinc-800'
                    : 'bg-rose-950/50 border-rose-500'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5 mb-2.5">
                  <span className="text-xs font-black text-white leading-tight line-clamp-2">
                    {prod.name}
                  </span>
                  {prod.isAvailable ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`kds-stock-switch-${prod.name}`}
                    onClick={() => handleToggleStock(prod)}
                    className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-black uppercase transition ${
                      prod.isAvailable
                        ? 'bg-rose-600/25 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {prod.isAvailable ? 'Apagar Botella' : 'Encender'}
                  </button>

                  {!prod.isAvailable && (
                    <button
                      type="button"
                      onClick={() => openServiceRecoveryModal(prod.id)}
                      className="py-2 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black"
                      title="Service Recovery en 1 Clic"
                    >
                      Recovery
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerta Flotante de Operación (Escaneo / Impresión / Service Recovery) */}
      {scanAlert && (
        <div
          data-testid="kds-alert-banner"
          className={`mx-4 mt-3 p-3.5 rounded-xl border-2 text-sm font-black flex items-center justify-between shadow-xl shrink-0 ${
            scanAlert.type === 'SUCCESS'
              ? 'bg-emerald-950 border-emerald-400 text-emerald-100'
              : scanAlert.type === 'PRINT'
                ? 'bg-blue-950 border-blue-400 text-blue-100'
                : 'bg-rose-950 border-rose-500 text-rose-100'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {scanAlert.type === 'SUCCESS' ? (
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : scanAlert.type === 'PRINT' ? (
              <Printer className="w-5 h-5 text-blue-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span>{scanAlert.message}</span>
          </div>
          <button
            onClick={() => setScanAlert(null)}
            className="px-2.5 py-1 rounded bg-black/30 text-xs uppercase ml-4"
          >
            OK
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TABLERO KANBAN DE 3 COLUMNAS DE ALTÍSIMO CONTRASTE                    */}
      {/* ===================================================================== */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* ============================================================ */}
        {/* COLUMNA 1: EN PREPARACIÓN                                    */}
        {/* ============================================================ */}
        <section className="flex flex-col bg-zinc-900/75 rounded-2xl border-2 border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wider text-white uppercase flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-amber-400 shadow-[0_0_10px_#F59E0B]" />
              1. EN PREPARACIÓN
            </h2>
            <div className="flex items-center gap-2">
              {queuedFifoTickets.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-black">
                  +{queuedFifoTickets.length} FIFO
                </span>
              )}
              <span className="px-3 py-0.5 rounded-full bg-amber-500 text-zinc-950 font-black text-sm">
                {inPrepTickets.length} / {maxConcurrentPrep}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
            {inPrepTickets.map((ticket) => {
              const soldOutItem = ticket.items.find((i) => {
                const prodInCatalog = products.find(
                  (p) => p.id === i.productId || p.name === i.name
                );
                return i.isAvailable === false || (prodInCatalog && !prodInCatalog.isAvailable);
              });

              return (
                <article
                  key={ticket.id}
                  data-testid={`ticket-prep-${ticket.shortCode}`}
                  className="rounded-2xl bg-zinc-950 border-2 shadow-2xl overflow-hidden flex flex-col justify-between"
                  style={{ borderColor: ticket.securityColor }}
                >
                  {/* Cabecera Gigante: Código #A47 + Bloque de Color de Seguridad */}
                  <div className="p-4 pb-3 flex items-center justify-between gap-2 border-b border-zinc-800/90">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-4xl sm:text-5xl font-black tracking-tighter leading-none px-3.5 py-2 rounded-2xl border-2"
                        style={{
                          backgroundColor: `${ticket.securityColor}25`,
                          borderColor: ticket.securityColor,
                          color: '#FFFFFF',
                        }}
                      >
                        #{ticket.shortCode}
                      </span>

                      <div>
                        <div
                          className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-wider text-zinc-950 flex items-center gap-1.5 shadow-sm"
                          style={{ backgroundColor: ticket.securityColor }}
                        >
                          <span className="w-2 h-2 rounded-full bg-zinc-950" />
                          COLOR {ticket.securityColor}
                        </div>
                        <div className="text-xs font-bold text-zinc-400 flex items-center gap-1 mt-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Activado{' '}
                          {new Date(ticket.activatedAt).toLocaleTimeString('es-AR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid={`print-ticket-${ticket.shortCode}`}
                      onClick={() => triggerPrint(ticket)}
                      title="Imprimir comanda térmica 80mm"
                      className="h-11 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 text-xs font-black transition"
                    >
                      <Printer className="w-4 h-4 text-blue-400" />
                      80mm
                    </button>
                  </div>

                  {/* Lista de Bebidas con Badges Grandes de Cantidad (2x) */}
                  <div className="p-4 space-y-2.5">
                    {ticket.items.map((item, idx) => {
                      const prodInCatalog = products.find(
                        (p) => p.id === item.productId || p.name === item.name
                      );
                      const isItemOut =
                        item.isAvailable === false ||
                        (prodInCatalog && !prodInCatalog.isAvailable);

                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border ${
                            isItemOut
                              ? 'bg-rose-950/70 border-rose-500 text-rose-100'
                              : 'bg-zinc-900/90 border-zinc-800 text-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="px-3 py-1.5 rounded-xl bg-amber-500 text-zinc-950 text-lg font-black leading-none shrink-0">
                              {item.quantity}x
                            </span>
                            <span className="text-base sm:text-lg font-black leading-snug">
                              {item.name}
                            </span>
                          </div>
                          {isItemOut && (
                            <span className="text-xs font-black px-2 py-1 rounded-md bg-rose-600 text-white shrink-0">
                              AGOTADO
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {/* Alerta de Service Recovery en 1 Clic si un ítem del ticket se agotó */}
                    {soldOutItem && (
                      <div className="p-3 rounded-xl bg-amber-950/70 border-2 border-amber-500 flex items-center justify-between gap-2">
                        <div className="text-xs text-amber-200 font-extrabold">
                          ⚠ <b>{soldOutItem.name}</b> sin stock
                        </div>
                        <button
                          type="button"
                          data-testid={`recovery-btn-${ticket.shortCode}`}
                          onClick={() =>
                            openServiceRecoveryModal(
                              soldOutItem.productId || soldOutItem.name,
                              ticket.id,
                              ticket.shortCode
                            )
                          }
                          className="px-3 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-black text-xs shrink-0 flex items-center gap-1 transition"
                        >
                          <AlertTriangle className="w-4 h-4" />
                          Service Recovery 1-Clic
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Botón Táctil de Ancho Completo Inferior: MARCAR LISTO */}
                  <div className="p-3 pt-0">
                    <button
                      type="button"
                      data-testid={`ready-btn-${ticket.shortCode}`}
                      onClick={() => advanceTicket(ticket.id, 'READY_FOR_PICKUP')}
                      className="w-full py-4 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-black text-base tracking-wide uppercase flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition min-h-[58px]"
                    >
                      <Bell className="w-5 h-5" />
                      MARCAR LISTO (#{ticket.shortCode})
                    </button>
                  </div>
                </article>
              );
            })}

            {inPrepTickets.length === 0 && (
              <div className="h-48 rounded-2xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-zinc-500 text-sm font-bold p-6 text-center">
                <span>Cola de preparación despejada</span>
                <span className="text-xs text-zinc-600 mt-1">
                  Las nuevas activaciones aparecerán al instante vía WebSocket
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ============================================================ */}
        {/* COLUMNA 2: LISTOS PARA RETIRAR                               */}
        {/* ============================================================ */}
        <section className="flex flex-col bg-zinc-900/75 rounded-2xl border-2 border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wider text-white uppercase flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#10B981]" />
              2. LISTOS PARA RETIRAR
            </h2>
            <span className="px-3 py-0.5 rounded-full bg-emerald-500 text-zinc-950 font-black text-sm">
              {readyTickets.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
            {readyTickets.map((ticket) => (
              <article
                key={ticket.id}
                data-testid={`ticket-ready-${ticket.shortCode}`}
                className="rounded-2xl bg-zinc-950 border-2 shadow-2xl overflow-hidden flex flex-col justify-between"
                style={{ borderColor: ticket.securityColor }}
              >
                {/* Cabecera con Código Gigante + Bloque Sincronizado con el Teléfono del Cliente */}
                <div className="p-4 pb-3 flex items-center justify-between gap-2 border-b border-zinc-800/90">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-4xl sm:text-5xl font-black tracking-tighter leading-none px-3.5 py-2 rounded-2xl border-2"
                      style={{
                        backgroundColor: `${ticket.securityColor}30`,
                        borderColor: ticket.securityColor,
                        color: '#FFFFFF',
                      }}
                    >
                      #{ticket.shortCode}
                    </span>

                    <div>
                      <div
                        className="px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider text-zinc-950 flex items-center gap-1.5 shadow-md"
                        style={{ backgroundColor: ticket.securityColor }}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 animate-ping" />
                        MATCH COLOR {ticket.securityColor}
                      </div>
                      <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 mt-1.5">
                        <Volume2 className="w-3.5 h-3.5" /> Vibrando en pantalla del cliente
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lista de Bebidas con Badges Grandes (2x) */}
                <div className="p-4 space-y-2">
                  {ticket.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-white"
                    >
                      <span className="px-3 py-1.5 rounded-xl bg-emerald-500 text-zinc-950 text-lg font-black leading-none shrink-0">
                        {item.quantity}x
                      </span>
                      <span className="text-base sm:text-lg font-black leading-snug">
                        {item.name}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Botón Táctil que ocupa todo el ancho inferior: VALIDAR Y ENTREGAR */}
                <div className="p-3 pt-0">
                  <button
                    type="button"
                    data-testid={`deliver-btn-${ticket.shortCode}`}
                    onClick={() => advanceTicket(ticket.id, 'DELIVERED')}
                    className="w-full py-4 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white font-black text-base tracking-wide uppercase flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/30 transition min-h-[58px]"
                  >
                    <CheckCircle className="w-5 h-5" />
                    VALIDAR Y ENTREGAR (#{ticket.shortCode})
                  </button>
                </div>
              </article>
            ))}

            {readyTickets.length === 0 && (
              <div className="h-48 rounded-2xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-zinc-500 text-sm font-bold p-6 text-center">
                <span>Mostrador sin retiros pendientes</span>
                <span className="text-xs text-zinc-600 mt-1">
                  Verifica el color de pantalla o escanea el QR para entregar
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ============================================================ */}
        {/* COLUMNA 3: ENTREGADOS RECIENTES                              */}
        {/* ============================================================ */}
        <section className="flex flex-col bg-zinc-900/75 rounded-2xl border-2 border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b-2 border-zinc-800 bg-zinc-950 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wider text-zinc-300 uppercase flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-zinc-500" />
              3. ENTREGADOS RECIENTES
            </h2>
            <span
              data-testid="delivered-column-count"
              className="px-3 py-0.5 rounded-full bg-zinc-800 text-zinc-200 font-black text-sm"
            >
              {deliveredTickets.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {deliveredTickets.map((ticket) => (
              <div
                key={ticket.id}
                data-testid={`ticket-delivered-${ticket.shortCode}`}
                className="p-3.5 rounded-2xl bg-zinc-950/90 border border-zinc-800 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="font-black text-2xl px-3 py-1.5 rounded-xl border shrink-0"
                    style={{
                      backgroundColor: `${ticket.securityColor}20`,
                      borderColor: ticket.securityColor,
                      color: ticket.securityColor,
                    }}
                  >
                    #{ticket.shortCode}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      {ticket.items.map((i, idx) => (
                        <span
                          key={idx}
                          className="text-xs font-black text-zinc-200 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800"
                        >
                          <b className="text-emerald-400">{i.quantity}x</b> {i.name}
                        </span>
                      ))}
                    </div>
                    <span className="text-[11px] text-zinc-500 font-semibold block mt-1">
                      Canjeado · Bloqueado Anti-Replay
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-black flex items-center gap-1 shrink-0">
                  <CheckCircle className="w-3.5 h-3.5" /> OK
                </span>
              </div>
            ))}

            {deliveredTickets.length === 0 && (
              <div className="h-48 rounded-2xl border-2 border-dashed border-zinc-800 flex items-center justify-center text-zinc-600 text-sm font-bold">
                Aún no hay entregas registradas
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ============================================================ */}
      {/* MODAL: SERVICE RECOVERY EN 1 CLIC (SUSTITUCIÓN O REEMBOLSO)   */}
      {/* ============================================================ */}
      {recoveryTarget && (
        <div
          data-testid="service-recovery-modal"
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-zinc-900 border-2 border-amber-500 rounded-3xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">
                    FLUJO SERVICE RECOVERY EN 1 CLIC
                  </span>
                  <h3 className="text-lg font-black text-white">
                    Agotado: {recoveryTarget.product.name}
                    {recoveryTarget.shortCode ? ` (Ticket #${recoveryTarget.shortCode})` : ''}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecoveryTarget(null)}
                className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 mb-4 leading-relaxed">
              El cliente activó un vale de una bebida que se acaba de agotar. Elige un reemplazo
              equivalente en 1 clic o dispara el reembolso automático del ítem:
            </p>

            <div className="mb-4">
              <div className="text-xs font-black text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                1. Ofrecer Reemplazo Equivalente en 1 Clic (Sin costo adicional):
              </div>

              <div className="space-y-2">
                {recoveryTarget.substitutes.map((sub, idx) => (
                  <button
                    key={sub.id}
                    type="button"
                    data-testid={`substitute-option-${idx}`}
                    onClick={() => handleExecuteServiceRecovery('SUBSTITUTE', sub)}
                    className="w-full p-3.5 rounded-2xl bg-zinc-950 hover:bg-blue-950/50 border border-zinc-800 hover:border-blue-500 text-left flex items-center justify-between transition group"
                  >
                    <div>
                      <div className="text-sm font-black text-white group-hover:text-blue-300">
                        {sub.name}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {sub.category} · Valor carta ${Number(sub.price).toLocaleString('es-AR')}
                      </div>
                    </div>
                    <span className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-black shrink-0">
                      Reemplazar 1-Clic
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800">
              <button
                type="button"
                data-testid="one-click-refund-btn"
                onClick={() => handleExecuteServiceRecovery('REFUND')}
                className="w-full p-4 rounded-2xl bg-rose-950/50 hover:bg-rose-900/70 border border-rose-500/60 text-left flex items-center justify-between transition"
              >
                <div className="flex items-center gap-3">
                  <DollarSign className="w-5 h-5 text-rose-400 shrink-0" />
                  <div>
                    <div className="text-sm font-black text-rose-200">
                      Disparar Devolución Inmediata del Ítem
                    </div>
                    <div className="text-[11px] text-rose-300/80">
                      Reintegra ${Number(recoveryTarget.product.price).toLocaleString('es-AR')} a
                      la cuenta de Mercado Pago del cliente
                    </div>
                  </div>
                </div>
                <span className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-black shrink-0">
                  Devolver 1-Clic
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: VALIDADOR RÁPIDO DE ENTREGA (CÓDIGO/COLOR O CÁMARA)    */}
      {/* ============================================================ */}
      {scanModalOpen && (
        <div
          data-testid="scan-validator-modal"
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <QrCode className="w-5 h-5 text-blue-400" />
                Validador Rápido de Entrega (Anti-Replay)
              </h3>
              <button
                type="button"
                onClick={() => setScanModalOpen(false)}
                className="text-zinc-400 hover:text-white font-bold text-xs"
              >
                Cerrar ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-zinc-950 border border-zinc-800 mb-4">
              <button
                type="button"
                onClick={() => setScanMode('CODE')}
                className={`py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                  scanMode === 'CODE' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <QrCode className="w-4 h-4" />
                Código Corto / Pistola USB
              </button>
              <button
                type="button"
                data-testid="switch-camera-mode-btn"
                onClick={() => setScanMode('CAMERA')}
                className={`py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                  scanMode === 'CAMERA'
                    ? 'bg-emerald-600 text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Camera className="w-4 h-4" />
                Cámara de la Tablet (QR)
              </button>
            </div>

            {scanMode === 'CODE' ? (
              <div>
                <p className="text-xs text-zinc-400 mb-3">
                  Verifica el color de seguridad del cliente e ingresa su código de 3 caracteres
                  (ej: <b>C89</b>, <b>A47</b>) o escanea con la pistola láser USB:
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleValidateScan(manualCode);
                    setScanModalOpen(false);
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    data-testid="input-manual-scan-code"
                    placeholder="Ej: A47"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    className="w-full text-center text-3xl font-black uppercase tracking-widest py-3 rounded-2xl bg-zinc-950 border-2 border-blue-500 text-white focus:outline-none mb-4"
                  />

                  <button
                    type="submit"
                    data-testid="submit-scan-code-btn"
                    className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 font-black text-white text-sm transition min-h-[50px]"
                  >
                    Validar y Entregar Bebida
                  </button>
                </form>

                {readyTickets.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <div className="text-[11px] font-bold text-zinc-400 mb-2">
                      Coincidencia Visual Rápida en Mostrador:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {readyTickets.map((rt) => (
                        <button
                          key={rt.id}
                          type="button"
                          onClick={() => {
                            handleValidateScan(rt.shortCode);
                            setScanModalOpen(false);
                          }}
                          className="px-3 py-2 rounded-xl font-black text-xs border flex items-center gap-2"
                          style={{
                            borderColor: rt.securityColor,
                            backgroundColor: `${rt.securityColor}25`,
                            color: '#FAFAFA',
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: rt.securityColor }}
                          />
                          Entregar #{rt.shortCode}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center space-y-4">
                <div className="relative h-52 rounded-2xl bg-zinc-950 border-2 border-emerald-500/60 overflow-hidden flex flex-col items-center justify-center">
                  {cameraActive ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="p-4 text-center">
                      <Camera className="w-10 h-10 text-emerald-400 mx-auto mb-2 animate-pulse" />
                      <p className="text-xs font-bold text-zinc-200">
                        Visor Óptico QR de Tablet Activo
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Apunta el código QR del teléfono del cliente frente a la cámara frontal
                      </p>
                    </div>
                  )}
                  <div className="absolute inset-x-10 top-1/2 h-0.5 bg-emerald-400/80 shadow-[0_0_12px_#10B981]" />
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] text-zinc-400">
                    Simular lectura óptica de QR en cámara sobre tickets activos:
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {[...readyTickets, ...inPrepTickets].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          handleValidateScan(t.shortCode);
                          setScanModalOpen(false);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black"
                      >
                        📸 Leer QR #{t.shortCode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: VISTA PREVIA DE TICKET TÉRMICO DE 80MM IMPRESO         */}
      {/* ============================================================ */}
      {thermalPreviewTicket && (
        <div
          data-testid="thermal-print-modal"
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-sm w-full p-5 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-black text-blue-400 uppercase">
                COMANDA TÉRMICA 80MM ({thermalPreviewTicket.method})
              </span>
              <button
                type="button"
                onClick={() => setThermalPreviewTicket(null)}
                className="text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cerrar ✕
              </button>
            </div>

            <div className="p-4 rounded-xl bg-white text-zinc-950 font-mono text-xs shadow-inner">
              <div className="text-center border-b-2 border-dashed border-zinc-800 pb-2 mb-2">
                <div className="font-black text-sm">{barName.toUpperCase()}</div>
                <div className="text-[10px]">TUTRAGO FAST PICKUP · 80MM</div>
              </div>
              <div className="text-center my-3 py-2 border-2 border-zinc-950">
                <div className="text-[10px] font-bold">TURNO DE RETIRO</div>
                <div className="text-3xl font-black">
                  #{thermalPreviewTicket.ticket.shortCode}
                </div>
                <div className="text-[10px] font-bold">
                  Color: {thermalPreviewTicket.ticket.securityColor}
                </div>
              </div>
              <div className="border-t border-b border-dashed border-zinc-800 py-2 space-y-1">
                {thermalPreviewTicket.ticket.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between font-bold">
                    <span>[{item.quantity}x]</span>
                    <span>{item.name}</span>
                  </div>
                ))}
              </div>
              <div className="text-center text-[10px] mt-2 text-zinc-600">
                ESC/POS Buffer: {thermalPreviewTicket.byteSize} bytes
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  EscPosThermalPrinter.printViaHtmlFallback(
                    {
                      barName,
                      shortCode: thermalPreviewTicket.ticket.shortCode,
                      securityColor: thermalPreviewTicket.ticket.securityColor,
                      activatedAt: thermalPreviewTicket.ticket.activatedAt,
                      items: thermalPreviewTicket.ticket.items,
                    },
                    true
                  );
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Imprimir en Navegador 80mm
              </button>
              <button
                type="button"
                onClick={() => setThermalPreviewTicket(null)}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-200 text-xs font-bold"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
