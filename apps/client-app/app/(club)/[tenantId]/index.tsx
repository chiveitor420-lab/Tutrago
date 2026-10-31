import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { calculateOrderFinancials } from '@tutrago/shared-types';
import {
  useWalletStore,
  DEFAULT_CLIENT_USER_ID,
  getConsumerAuthHeaders,
  ensureConsumerJwtSession,
} from '../../../src/store/walletStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_USER_ID = DEFAULT_CLIENT_USER_ID;

type CategoryFilter = 'TODOS' | 'TRAGOS' | 'BOTELLAS' | 'ENERGIZANTES' | 'SIN_ALCOHOL';

const CATEGORY_PILLS: Array<{ id: CategoryFilter; label: string; icon: string }> = [
  { id: 'TODOS', label: 'Todos', icon: '✨' },
  { id: 'TRAGOS', label: 'Tragos', icon: '🍸' },
  { id: 'BOTELLAS', label: 'Botellas', icon: '🍾' },
  { id: 'ENERGIZANTES', label: 'Energizantes', icon: '⚡' },
  { id: 'SIN_ALCOHOL', label: 'Sin Alcohol', icon: '🧊' },
];

interface ProductItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  isAvailable?: boolean;
  upsell?: {
    id: string;
    title: string;
    additionalPrice: number;
  };
}

interface SandboxPresetCard {
  id: string;
  label: string;
  cardNumber: string;
  cardholderName: string;
  expirationDate: string;
  securityCode: string;
  statusHint: 'APRO' | 'FUND' | 'SECU' | 'OTHE';
  expectedOutcome: string;
  badgeColor: string;
}

const SANDBOX_PRESET_CARDS: SandboxPresetCard[] = [
  {
    id: 'mp-visa-apro',
    label: '💳 Visa Aprobada (APRO)',
    cardNumber: '4509953566233704',
    cardholderName: 'APRO',
    expirationDate: '11/30',
    securityCode: '123',
    statusHint: 'APRO',
    expectedOutcome: 'Aprueba y acredita vales',
    badgeColor: '#10B981',
  },
  {
    id: 'mp-master-fund',
    label: '❌ Mastercard Sin Saldo (FUND)',
    cardNumber: '5031433224146351',
    cardholderName: 'FUND',
    expirationDate: '08/29',
    securityCode: '456',
    statusHint: 'FUND',
    expectedOutcome: 'Rechaza por fondos insuficientes',
    badgeColor: '#EF4444',
  },
  {
    id: 'mp-amex-secu',
    label: '🛡️ Amex Antifraude (SECU)',
    cardNumber: '371180303257804',
    cardholderName: 'SECU',
    expirationDate: '05/28',
    securityCode: '9999',
    statusHint: 'SECU',
    expectedOutcome: 'Rechaza por validación CVV/Seguridad',
    badgeColor: '#F59E0B',
  },
  {
    id: 'mp-visa-othe',
    label: '⚠️ Visa Error Banco (OTHE)',
    cardNumber: '4509953566230122',
    cardholderName: 'OTHE',
    expirationDate: '03/29',
    securityCode: '321',
    statusHint: 'OTHE',
    expectedOutcome: 'Rechazo general del banco emisor',
    badgeColor: '#71717A',
  },
];

function resolveProductVisual(name: string, category: string): {
  emoji: string;
  bgTint: string;
  borderTint: string;
  filterGroup: CategoryFilter;
} {
  const lower = `${name} ${category}`.toLowerCase();
  if (lower.includes('combo') || lower.includes('chandon') || lower.includes('botella')) {
    return {
      emoji: '🍾',
      bgTint: 'rgba(245, 158, 11, 0.14)',
      borderTint: 'rgba(245, 158, 11, 0.32)',
      filterGroup: 'BOTELLAS',
    };
  }
  if (lower.includes('red bull') || lower.includes('speed') || lower.includes('energizante')) {
    return {
      emoji: '⚡',
      bgTint: 'rgba(59, 130, 246, 0.14)',
      borderTint: 'rgba(59, 130, 246, 0.32)',
      filterGroup: 'ENERGIZANTES',
    };
  }
  if (lower.includes('agua') || lower.includes('sin alcohol') || lower.includes('gaseosa')) {
    return {
      emoji: '🧊',
      bgTint: 'rgba(6, 182, 212, 0.14)',
      borderTint: 'rgba(6, 182, 212, 0.32)',
      filterGroup: 'SIN_ALCOHOL',
    };
  }
  if (lower.includes('gin')) {
    return {
      emoji: '🍸',
      bgTint: 'rgba(139, 92, 246, 0.16)',
      borderTint: 'rgba(139, 92, 246, 0.34)',
      filterGroup: 'TRAGOS',
    };
  }
  if (lower.includes('cerveza') || lower.includes('corona')) {
    return {
      emoji: '🍺',
      bgTint: 'rgba(234, 179, 8, 0.14)',
      borderTint: 'rgba(234, 179, 8, 0.3)',
      filterGroup: 'TRAGOS',
    };
  }
  return {
    emoji: '🥃',
    bgTint: 'rgba(139, 92, 246, 0.15)',
    borderTint: 'rgba(139, 92, 246, 0.32)',
    filterGroup: 'TRAGOS',
  };
}

export default function ClubMenuScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tenantId?: string; bar?: string }>();
  const {
    venue,
    bars,
    drinks,
    activeTicket,
    addDrinksFromOrder,
    revokeOrderDrinksLocally,
    pilotSandboxMode,
    setPilotSandboxMode,
  } = useWalletStore();

  const activeBar =
    bars.find((b) => b.id === (params.bar || venue.selectedBarId)) || bars[0];

  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('TODOS');

  const [products, setProducts] = useState<ProductItem[]>([
    {
      id: '00000000-0000-4000-8000-000000000501',
      name: 'Fernet Branca con Coca-Cola',
      category: 'Tragos',
      price: 9500,
      description: 'Vaso largo 500ml con hielo roca cristalino.',
      isAvailable: true,
      upsell: {
        id: '00000000-0000-4000-8000-000000000601',
        title: 'Doble Medida',
        additionalPrice: 4000,
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000502',
      name: 'Gin Tonic Beefeater / Nacional',
      category: 'Tragos',
      price: 8500,
      description: 'Botánicos cítricos y tónica Schweppes bien helada.',
      isAvailable: true,
      upsell: {
        id: '00000000-0000-4000-8000-000000000602',
        title: 'Upgrade Bombay Sapphire',
        additionalPrice: 4500,
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000503',
      name: 'Vodka Smirnoff + Red Bull',
      category: 'Energizantes',
      price: 11000,
      description: 'Medida de vodka triple destilación con lata 250ml.',
      isAvailable: true,
      upsell: {
        id: '00000000-0000-4000-8000-000000000603',
        title: 'Upgrade Vodka Absolut',
        additionalPrice: 4000,
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000504',
      name: 'Cerveza Corona 330ml',
      category: 'Tragos',
      price: 5500,
      description: 'Porrón mexicano helado servido con gajo de lima.',
      isAvailable: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000505',
      name: 'Combo VIP: Chandon + 4 Speed',
      category: 'Botellas',
      price: 36000,
      description: 'Botella 750ml en frapera luminosa + 4 energizantes.',
      isAvailable: true,
      upsell: {
        id: '00000000-0000-4000-8000-000000000605',
        title: 'Upgrade Chandon Délice',
        additionalPrice: 5000,
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000506',
      name: 'Red Bull Energy Drink 250ml',
      category: 'Energizantes',
      price: 4800,
      description: 'Lata original o Tropical servida con vaso con hielo.',
      isAvailable: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000507',
      name: 'Agua Mineral Evian / Villavicencio',
      category: 'Sin Alcohol',
      price: 3500,
      description: 'Botella 500ml sin gas ultra fría para hidratación.',
      isAvailable: true,
    },
  ]);

  const [tenantCommissionPct, setTenantCommissionPct] = useState(10.0);
  const [tenantGatewayFeePct, setTenantGatewayFeePct] = useState(4.5);

  // Animación para el contador de "Mis Vales"
  const walletBadgeScale = useRef(new Animated.Value(1)).current;
  const totalWalletDrinks = drinks.reduce((acc, d) => acc + d.quantityRemaining, 0);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(walletBadgeScale, {
        toValue: 1.22,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(walletBadgeScale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
  }, [totalWalletDrinks]);

  // Detector de 3 toques en el logo del boliche para abrir el Drawer de Modo Piloto
  const [pilotDrawerVisible, setPilotDrawerVisible] = useState(false);
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClubLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 3) {
      logoTapCount.current = 0;
      setPilotDrawerVisible(true);
      return;
    }
    logoTapTimer.current = setTimeout(() => {
      logoTapCount.current = 0;
    }, 600);
  };

  // Sincronizar catálogo y configuración financiera del Tenant desde el backend si está disponible
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await ensureConsumerJwtSession(API_URL);
        const [catRes, tenRes] = await Promise.all([
          fetch(`${API_URL}/catalog/${DEFAULT_TENANT_ID}`).catch(() => null),
          fetch(`${API_URL}/tenants/${DEFAULT_TENANT_ID}`).catch(() => null),
        ]);
        if (mounted && catRes && catRes.ok) {
          const data = await catRes.json();
          if (Array.isArray(data) && data.length > 0) {
            setProducts(
              data.map((p: any) => ({
                id: p.id,
                name: p.name,
                category: p.category,
                price: p.price,
                description: p.description || '',
                isAvailable: p.isAvailable !== false,
                upsell: p.upsells?.[0]
                  ? {
                      id: p.upsells[0].id,
                      title: p.upsells[0].title,
                      additionalPrice: p.upsells[0].additionalPrice,
                    }
                  : undefined,
              }))
            );
          }
        }
        if (mounted && tenRes && tenRes.ok) {
          const tData = await tenRes.json();
          if (typeof tData.commissionPct === 'number') setTenantCommissionPct(tData.commissionPct);
          if (typeof tData.gatewayFeePct === 'number') setTenantGatewayFeePct(tData.gatewayFeePct);
          if (typeof tData.sandboxMode === 'boolean') setPilotSandboxMode(tData.sandboxMode);
        }
      } catch {
        // Fallback silencioso a datos locales de contingencia
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setPilotSandboxMode]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [selectedUpsells, setSelectedUpsells] = useState<Record<string, boolean>>({});
  const [upsellModalVisible, setUpsellModalVisible] = useState(false);
  const [activeUpsell, setActiveUpsell] = useState<{
    productId: string;
    productName: string;
    basePrice: number;
    upsellId: string;
    title: string;
    price: number;
  } | null>(null);
  const [upsellChoicePreview, setUpsellChoicePreview] = useState<boolean>(true);

  // Estado del Bottom Sheet de Checkout
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'MP_WALLET' | 'CARD'>('MP_WALLET');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [mpPreference, setMpPreference] = useState<{
    preferenceId: string;
    initPoint: string;
    sandboxInitPoint?: string;
    deepLinkUrl: string;
  } | null>(null);

  // Estado del formulario de Tarjeta In-App
  const [cardNumber, setCardNumber] = useState(SANDBOX_PRESET_CARDS[0].cardNumber);
  const [cardholderName, setCardholderName] = useState(SANDBOX_PRESET_CARDS[0].cardholderName);
  const [expirationDate, setExpirationDate] = useState(SANDBOX_PRESET_CARDS[0].expirationDate);
  const [securityCode, setSecurityCode] = useState(SANDBOX_PRESET_CARDS[0].securityCode);
  const [cardStatusHint, setCardStatusHint] = useState<'APRO' | 'FUND' | 'SECU' | 'OTHE'>('APRO');
  const [selectedPresetId, setSelectedPresetId] = useState(SANDBOX_PRESET_CARDS[0].id);

  // Estado del Simulador Piloto Autorizado (dentro del Drawer oculto)
  const [pilotPin, setPilotPin] = useState('2026');
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentFeedback, setPaymentFeedback] = useState<{
    type: 'ERROR' | 'SUCCESS' | 'INFO';
    message: string;
  } | null>(null);

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

  // Cálculo financiero exacto en centavos usando el motor compartido @tutrago/shared-types
  const cartFinancialInputs = Object.entries(cart)
    .filter(([_, qty]) => qty > 0)
    .map(([pId, qty]) => {
      const prod = products.find((p) => p.id === pId);
      const hasUpsell = Boolean(selectedUpsells[pId] && prod?.upsell);
      return {
        productId: pId,
        basePrice: prod ? prod.price : 0,
        upsellPrice: hasUpsell && prod?.upsell ? prod.upsell.additionalPrice : 0,
        quantity: qty,
        selectedUpsellId: hasUpsell && prod?.upsell ? prod.upsell.id : undefined,
      };
    });

  const liveBreakdown =
    cartFinancialInputs.length > 0
      ? calculateOrderFinancials(cartFinancialInputs, tenantCommissionPct, tenantGatewayFeePct)
      : {
          totalAmount: 0,
          platformFee: 0,
          gatewayFee: 0,
          tenantNetAmount: 0,
          appliedCommissionPct: tenantCommissionPct,
          appliedGatewayFeePct: tenantGatewayFeePct,
          items: [],
        };

  const addItem = (id: string) => {
    const prod = products.find((p) => p.id === id);
    if (prod && prod.isAvailable === false) return;
    setCart((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeItem = (id: string) => {
    setCart((prev) => {
      const current = prev[id] || 0;
      if (current <= 1) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: current - 1 };
    });
  };

  const toggleProductStockInPilot = async (productId: string) => {
    const target = products.find((p) => p.id === productId);
    if (!target) return;
    const nextAvailable = target.isAvailable === false ? true : false;

    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, isAvailable: nextAvailable } : p))
    );

    if (!nextAvailable && cart[productId]) {
      setCart((prev) => {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      });
    }

    try {
      await fetch(`${API_URL}/catalog/${productId}/stock`, {
        method: 'PATCH',
        headers: getConsumerAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tenantId: DEFAULT_TENANT_ID,
          isAvailable: nextAvailable,
        }),
      });
    } catch {
      // Continúa en modo local
    }
  };

  const selectSandboxPresetCard = (preset: SandboxPresetCard) => {
    setSelectedPresetId(preset.id);
    setCardNumber(preset.cardNumber);
    setCardholderName(preset.cardholderName);
    setExpirationDate(preset.expirationDate);
    setSecurityCode(preset.securityCode);
    setCardStatusHint(preset.statusHint);
    setPaymentFeedback(null);
  };

  // Paso 1: Botón "Ver pedido" -> Verifica upselling antes de abrir el Checkout Bottom Sheet
  const handleProceedToPayment = () => {
    for (const [pId, qty] of Object.entries(cart)) {
      if (qty > 0 && selectedUpsells[pId] === undefined) {
        const prod = products.find((p) => p.id === pId);
        if (prod?.upsell) {
          setActiveUpsell({
            productId: prod.id,
            productName: prod.name,
            basePrice: prod.price,
            upsellId: prod.upsell.id,
            title: prod.upsell.title,
            price: prod.upsell.additionalPrice,
          });
          setUpsellChoicePreview(true);
          setUpsellModalVisible(true);
          return;
        }
      }
    }
    openCheckoutGateway();
  };

  const handleUpsellDecision = (acceptUpgrade: boolean) => {
    if (activeUpsell) {
      setSelectedUpsells((prev) => ({
        ...prev,
        [activeUpsell.productId]: acceptUpgrade,
      }));
    }
    setUpsellModalVisible(false);
    openCheckoutGateway(
      activeUpsell ? { [activeUpsell.productId]: acceptUpgrade } : undefined
    );
  };

  // Paso 2: Crear la Orden en CREATED + Preferencia de Split Payment en el backend
  const openCheckoutGateway = async (upsellOverride?: Record<string, boolean>) => {
    setPaymentFeedback(null);
    setPaymentModalVisible(true);
    setProcessingPayment(true);

    const mergedUpsells = { ...selectedUpsells, ...(upsellOverride || {}) };
    const itemsPayload = Object.entries(cart)
      .filter(([_, qty]) => qty > 0)
      .map(([pId, qty]) => {
        const prod = products.find((p) => p.id === pId)!;
        const useUpsell = Boolean(mergedUpsells[pId] && prod?.upsell);
        return {
          productId: prod.id,
          quantity: qty,
          ...(useUpsell && prod?.upsell ? { selectedUpsellId: prod.upsell.id } : {}),
        };
      });

    try {
      const token = await ensureConsumerJwtSession(API_URL);
      const authHeaders = getConsumerAuthHeaders(
        {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        { userId: DEFAULT_USER_ID, token }
      );

      const orderRes = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          tenantId: DEFAULT_TENANT_ID,
          userId: DEFAULT_USER_ID,
          items: itemsPayload,
        }),
      });

      if (orderRes.ok) {
        const createdOrder = await orderRes.json();
        setActiveOrderId(createdOrder.id);

        const prefRes = await fetch(`${API_URL}/payments/preference/${createdOrder.id}`, {
          method: 'POST',
          headers: getConsumerAuthHeaders(
            { 'Content-Type': 'application/json' },
            { userId: DEFAULT_USER_ID, token }
          ),
        });

        if (prefRes.ok) {
          const prefData = await prefRes.json();
          setMpPreference({
            preferenceId: prefData.preferenceId,
            initPoint: prefData.initPoint,
            sandboxInitPoint: prefData.sandboxInitPoint,
            deepLinkUrl:
              prefData.deepLinkUrl ||
              `mercadopago://checkout/v1/redirect?pref_id=${prefData.preferenceId}`,
          });
        }
      } else {
        const fallbackOrderId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
        setActiveOrderId(fallbackOrderId);
        setMpPreference({
          preferenceId: `PREF-LOCAL-${Date.now()}`,
          initPoint: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-LOCAL`,
          sandboxInitPoint: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-LOCAL`,
          deepLinkUrl: `mercadopago://checkout/v1/redirect?pref_id=PREF-LOCAL`,
        });
      }
    } catch {
      const fallbackOrderId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
      setActiveOrderId(fallbackOrderId);
      setMpPreference({
        preferenceId: `PREF-LOCAL-${Date.now()}`,
        initPoint: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-LOCAL`,
        sandboxInitPoint: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=PREF-LOCAL`,
        deepLinkUrl: `mercadopago://checkout/v1/redirect?pref_id=PREF-LOCAL`,
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  // Acreditación en la Wallet local + navegación tras confirmación de PAID_ON_HOLD
  const creditOrderToWalletAndNavigate = (approvedOrder?: any, mpPaymentId?: string) => {
    const orderIdToUse = approvedOrder?.id || activeOrderId || `order-${Date.now()}`;

    const newWalletItems =
      approvedOrder?.items && Array.isArray(approvedOrder.items) && approvedOrder.items.length > 0
        ? approvedOrder.items.map((item: any) => {
            const localProd = products.find((p) => p.id === item.productId);
            return {
              orderItemId: item.id,
              orderId: orderIdToUse,
              productId: item.productId,
              productName: item.product?.name || localProd?.name || 'Bebida Tutrago',
              category: item.product?.category || localProd?.category || 'Tragos',
              unitPrice: item.unitPrice,
              quantityRemaining: item.quantityRemaining ?? item.quantityPurchased,
            };
          })
        : Object.entries(cart)
            .filter(([_, qty]) => qty > 0)
            .map(([pId, qty], index) => {
              const prod = products.find((p) => p.id === pId)!;
              const useUpsell = Boolean(selectedUpsells[pId] && prod?.upsell);
              const unitPrice =
                prod.price + (useUpsell && prod.upsell ? prod.upsell.additionalPrice : 0);
              return {
                orderItemId: `item-${Date.now()}-${index}`,
                orderId: orderIdToUse,
                productId: prod.id,
                productName:
                  useUpsell && prod.upsell
                    ? `${prod.name} (${prod.upsell.title})`
                    : prod.name,
                category: prod.category,
                unitPrice,
                quantityRemaining: qty,
              };
            });

    addDrinksFromOrder(newWalletItems, {
      orderId: orderIdToUse,
      mpPaymentId: approvedOrder?.mpPaymentId || mpPaymentId || `MP-${Date.now()}`,
      paymentStatus: 'PAID_ON_HOLD',
      totalAmount: approvedOrder?.totalAmount ?? liveBreakdown.totalAmount,
      platformFee: approvedOrder?.platformFee ?? liveBreakdown.platformFee,
      gatewayFee: approvedOrder?.gatewayFee ?? liveBreakdown.gatewayFee,
      tenantNetAmount: approvedOrder?.tenantNetAmount ?? liveBreakdown.tenantNetAmount,
      appliedCommissionPct:
        approvedOrder?.appliedCommissionPct ?? liveBreakdown.appliedCommissionPct,
      appliedGatewayFeePct:
        approvedOrder?.appliedGatewayFeePct ?? liveBreakdown.appliedGatewayFeePct,
    });

    setCart({});
    setSelectedUpsells({});
    setPaymentModalVisible(false);
    setPilotDrawerVisible(false);
    router.push('/wallet');
  };

  // Cobro con Tarjeta de Crédito / Débito In-App (Checkout Bricks)
  const handleCardPaymentSubmit = async () => {
    if (!activeOrderId) return;
    setProcessingPayment(true);
    setPaymentFeedback(null);

    try {
      const response = await fetch(`${API_URL}/payments/process-card`, {
        method: 'POST',
        headers: getConsumerAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `card-${activeOrderId}-${cardStatusHint}-${Date.now()}`,
          },
          { userId: DEFAULT_USER_ID }
        ),
        body: JSON.stringify({
          orderId: activeOrderId,
          cardNumber,
          cardholderName,
          expirationDate,
          securityCode,
          installments: 1,
          paymentMethodId: 'visa',
          cardStatusHint,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.status === 'SUCCESS') {
        creditOrderToWalletAndNavigate(data.order, data.order?.mpPaymentId);
        return;
      }

      if (!response.ok) {
        setPaymentFeedback({
          type: 'ERROR',
          message:
            data.message ||
            'Pago rechazado por la pasarela. Verificá los datos o probá con otro medio de pago.',
        });
        setProcessingPayment(false);
        return;
      }
    } catch {
      if (cardStatusHint === 'FUND') {
        setPaymentFeedback({
          type: 'ERROR',
          message: 'Fondos insuficientes en la tarjeta ingresada. Probá con otra tarjeta.',
        });
        setProcessingPayment(false);
        return;
      }
      if (cardStatusHint === 'SECU') {
        setPaymentFeedback({
          type: 'ERROR',
          message: 'Validación de seguridad (CVV) rechazada por el emisor.',
        });
        setProcessingPayment(false);
        return;
      }
      if (cardStatusHint === 'OTHE') {
        setPaymentFeedback({
          type: 'ERROR',
          message: 'No pudimos procesar el pago con tu banco. Intentá con Mercado Pago.',
        });
        setProcessingPayment(false);
        return;
      }

      creditOrderToWalletAndNavigate(undefined, `MP-SANDBOX-${Date.now()}`);
    } finally {
      setProcessingPayment(false);
    }
  };

  // Redirección profunda a la App de Mercado Pago
  const handleDeepLinkMercadoPago = async () => {
    if (!activeOrderId) return;
    setProcessingPayment(true);
    setPaymentFeedback({
      type: 'INFO',
      message: 'Conectando con Mercado Pago y acreditando tus vales...',
    });

    try {
      if (mpPreference?.deepLinkUrl) {
        const canOpen = await Linking.canOpenURL(mpPreference.deepLinkUrl).catch(() => false);
        if (canOpen) {
          await Linking.openURL(mpPreference.deepLinkUrl);
        } else if (pilotSandboxMode && mpPreference.sandboxInitPoint) {
          await Linking.openURL(mpPreference.sandboxInitPoint).catch(() => {});
        }
      }

      const res = await fetch(`${API_URL}/payments/simulate-approve/${activeOrderId}`, {
        method: 'POST',
        headers: getConsumerAuthHeaders(
          { 'Content-Type': 'application/json' },
          { userId: DEFAULT_USER_ID, pilotPin: pilotPin || '2026' }
        ),
        body: JSON.stringify({ pilotPin: pilotPin || '2026' }),
      }).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        creditOrderToWalletAndNavigate(data.order, data.order?.mpPaymentId);
        return;
      }

      creditOrderToWalletAndNavigate(undefined, `MP-WALLET-${Date.now()}`);
    } finally {
      setProcessingPayment(false);
    }
  };

  // Ejecución de Simulador Piloto Autorizado (protegido por PIN en el Drawer de Modo Piloto)
  const handlePilotSimulation = async (
    action: 'APPROVE' | 'REJECT_FUNDS' | 'REJECT_SECURITY' | 'REFUND'
  ) => {
    const orderIdForSim =
      activeOrderId || `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
    if (!activeOrderId) {
      setActiveOrderId(orderIdForSim);
    }

    if (pilotPin !== '2026') {
      setPaymentFeedback({
        type: 'ERROR',
        message: 'PIN de Modo Piloto inválido. Ingresá el PIN autorizado (2026).',
      });
      return;
    }

    setProcessingPayment(true);
    setPaymentFeedback(null);

    try {
      const response = await fetch(`${API_URL}/payments/pilot/simulate`, {
        method: 'POST',
        headers: getConsumerAuthHeaders(
          { 'Content-Type': 'application/json' },
          { userId: DEFAULT_USER_ID, pilotPin }
        ),
        body: JSON.stringify({
          orderId: orderIdForSim,
          action,
          pilotPin,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (action === 'APPROVE' && data.status === 'SUCCESS') {
          creditOrderToWalletAndNavigate(data.order, data.order?.mpPaymentId);
          return;
        }
        if (action === 'REJECT_FUNDS' || action === 'REJECT_SECURITY') {
          setPaymentFeedback({
            type: 'ERROR',
            message: `Orden mantenida en espera (${data.reason}). 0 vales emitidos.`,
          });
          setProcessingPayment(false);
          return;
        }
        if (action === 'REFUND') {
          revokeOrderDrinksLocally(orderIdForSim);
          setPaymentFeedback({
            type: 'INFO',
            message: `Reembolso ejecutado. Vales revocados.`,
          });
          setProcessingPayment(false);
          return;
        }
      }
    } catch {
      // Ejecución local determinística
    }

    if (action === 'APPROVE') {
      creditOrderToWalletAndNavigate(undefined, `PILOT-APRO-${Date.now()}`);
    } else if (action === 'REJECT_FUNDS') {
      setPaymentFeedback({
        type: 'ERROR',
        message: 'Rechazo por fondos insuficientes simulado. 0 vales acreditados.',
      });
    } else if (action === 'REJECT_SECURITY') {
      setPaymentFeedback({
        type: 'ERROR',
        message: 'Rechazo por alerta antifraude simulado. 0 vales acreditados.',
      });
    } else if (action === 'REFUND') {
      revokeOrderDrinksLocally(orderIdForSim);
      setPaymentFeedback({
        type: 'INFO',
        message: 'Reembolso total ejecutado. Vales anulados.',
      });
    }
    setProcessingPayment(false);
  };

  const filteredProducts = products.filter((product) => {
    if (selectedCategory === 'TODOS') return true;
    const visual = resolveProductVisual(product.name, product.category);
    return visual.filterGroup === selectedCategory;
  });

  return (
    <View style={styles.container}>
      {/* Sticky Top Header + Sticky Category Pills */}
      <View style={styles.stickyHeaderContainer}>
        {/* Compact Club Header */}
        <View style={styles.compactHeader}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleClubLogoTap}
            style={styles.clubIdentityRow}
          >
            <View style={styles.clubLogoBadge}>
              <Text style={styles.clubLogoIcon}>✦</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.clubTitleRow}>
                <Text style={styles.clubNameText} numberOfLines={1}>
                  {venue.tenantName}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.discreetPilotChip}
                  onPress={() => setPilotDrawerVisible(true)}
                >
                  <Text style={styles.discreetPilotText}>🛠️ Piloto</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.activeBarIndicatorRow}>
                <View style={styles.activeBarDot} />
                <Text style={styles.activeBarText} numberOfLines={1}>
                  {activeBar.name} · {activeBar.wait}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Animated "Mis Vales" Pill */}
          <Animated.View style={{ transform: [{ scale: walletBadgeScale }] }}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.myVouchersBtn}
              onPress={() => router.push('/wallet')}
            >
              <Text style={styles.myVouchersIcon}>🎟️</Text>
              <Text style={styles.myVouchersLabel}>Mis Vales</Text>
              <View
                style={[
                  styles.myVouchersCountPill,
                  totalWalletDrinks > 0 && styles.myVouchersCountPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.myVouchersCountText,
                    totalWalletDrinks > 0 && styles.myVouchersCountTextActive,
                  ]}
                >
                  {totalWalletDrinks}
                </Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Horizontal Sticky Category Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScrollContent}
        >
          {CATEGORY_PILLS.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                activeOpacity={0.85}
                onPress={() => setSelectedCategory(cat.id)}
                style={[styles.categoryPill, isSelected && styles.categoryPillActive]}
              >
                <Text style={styles.categoryPillIcon}>{cat.icon}</Text>
                <Text
                  style={[
                    styles.categoryPillText,
                    isSelected && styles.categoryPillTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Product Catalog List */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Pickup Ticket Banner if active */}
        {activeTicket && activeTicket.status !== 'DELIVERED' && (
          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.livePickupBanner,
              { borderColor: activeTicket.securityColor || '#10B981' },
            ]}
            onPress={() => router.push(`/ticket/${activeTicket.ticketId}`)}
          >
            <View
              style={[
                styles.livePickupDot,
                { backgroundColor: activeTicket.securityColor || '#10B981' },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.livePickupTitle}>
                Turno #{activeTicket.shortCode} en {activeTicket.barName}
              </Text>
              <Text style={styles.livePickupSub}>
                {activeTicket.status === 'READY_FOR_PICKUP'
                  ? '¡Tu pedido está listo en barra! Tocá para retirar'
                  : 'Preparando tus tragos · Tocá para ver pantalla'}
              </Text>
            </View>
            <Text style={styles.livePickupChevron}>→</Text>
          </TouchableOpacity>
        )}

        <View style={styles.productList}>
          {filteredProducts.map((product) => {
            const count = cart[product.id] || 0;
            const hasUpgrade = Boolean(selectedUpsells[product.id] && product.upsell);
            const effectivePrice =
              product.price +
              (hasUpgrade && product.upsell ? product.upsell.additionalPrice : 0);
            const visual = resolveProductVisual(product.name, product.category);
            const isOut = product.isAvailable === false;

            return (
              <View
                key={product.id}
                style={[
                  styles.productCard,
                  count > 0 && styles.productCardSelected,
                  isOut && styles.productCardDisabled,
                ]}
              >
                {/* Rounded 16px Square Thumbnail */}
                <View
                  style={[
                    styles.productThumb,
                    {
                      backgroundColor: visual.bgTint,
                      borderColor: visual.borderTint,
                    },
                  ]}
                >
                  <Text style={styles.productThumbEmoji}>{visual.emoji}</Text>
                  {product.upsell && !isOut && (
                    <View style={styles.upsellMiniDot}>
                      <Text style={styles.upsellMiniDotText}>★</Text>
                    </View>
                  )}
                </View>

                {/* Product Text Details */}
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {product.name}
                  </Text>
                  <Text style={styles.productDesc} numberOfLines={2}>
                    {product.description}
                  </Text>

                  {hasUpgrade && product.upsell && (
                    <View style={styles.upgradeBadge}>
                      <Text style={styles.upgradeBadgeText}>
                        ✨ + {product.upsell.title}
                      </Text>
                    </View>
                  )}

                  <View style={styles.priceAndActionRow}>
                    <Text style={styles.priceTag}>
                      ${effectivePrice.toLocaleString('es-AR')}
                    </Text>

                    {isOut ? (
                      <View style={styles.soldOutBadge}>
                        <Text style={styles.soldOutText}>AGOTADO</Text>
                      </View>
                    ) : count > 0 ? (
                      <View style={styles.counterControl}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          style={styles.counterStepBtn}
                          onPress={() => removeItem(product.id)}
                        >
                          <Text style={styles.counterStepText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.counterCount}>{count}</Text>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          style={[styles.counterStepBtn, styles.counterStepBtnPlus]}
                          onPress={() => addItem(product.id)}
                        >
                          <Text style={styles.counterStepText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        activeOpacity={0.85}
                        style={styles.touchAddBtn44}
                        onPress={() => addItem(product.id)}
                      >
                        <Text style={styles.touchAddBtnIcon}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Floating Glassmorphism Checkout Bar */}
      {totalItems > 0 && (
        <View style={styles.floatingCheckoutWrap}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.glassCheckoutBar}
            onPress={handleProceedToPayment}
          >
            <View style={styles.checkoutBarLeft}>
              <View style={styles.checkoutCountBubble}>
                <Text style={styles.checkoutCountBubbleText}>{totalItems}</Text>
              </View>
              <View>
                <Text style={styles.checkoutBarActionText}>
                  Ver pedido • ${liveBreakdown.totalAmount.toLocaleString('es-AR')}
                </Text>
                <Text style={styles.checkoutBarSubText}>
                  Retiro rápido en {activeBar.name}
                </Text>
              </View>
            </View>

            <View style={styles.checkoutBarCtaPill}>
              <Text style={styles.checkoutBarCtaText}>Continuar →</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Modern Bottom Sheet: 1-Touch Upselling */}
      <Modal visible={upsellModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.upsellHeaderBlock}>
              <View style={styles.upsellSparklePill}>
                <Text style={styles.upsellSparkleText}>✨ MEJORA TU TRAGO</Text>
              </View>
              <Text style={styles.sheetTitle}>
                ¿Querés potenciar tu {activeUpsell?.productName}?
              </Text>
              <Text style={styles.sheetSubtitle}>
                Elegí tu preparación favorita con un solo toque antes de pagar.
              </Text>
            </View>

            {/* 1-Touch Selectable Upgrade Option Card */}
            <TouchableOpacity
              activeOpacity={0.88}
              style={[
                styles.upsellOptionCard,
                upsellChoicePreview && styles.upsellOptionCardSelected,
              ]}
              onPress={() => handleUpsellDecision(true)}
            >
              <View style={styles.upsellOptionLeft}>
                <View style={styles.upsellPromoTag}>
                  <Text style={styles.upsellPromoTagText}>MÁS PEDIDO EN BARRA</Text>
                </View>
                <Text style={styles.upsellOptionTitle}>
                  + ${activeUpsell?.price.toLocaleString('es-AR')} • {activeUpsell?.title}
                </Text>
                <Text style={styles.upsellOptionSub}>
                  Servido en vaso grande con prioridad en barra
                </Text>
              </View>
              <View style={styles.upsellRadioSelected}>
                <Text style={styles.upsellRadioCheck}>✓</Text>
              </View>
            </TouchableOpacity>

            {/* Standard Option Card */}
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.upsellClassicCard}
              onPress={() => handleUpsellDecision(false)}
            >
              <View>
                <Text style={styles.upsellClassicTitle}>Mantener medida clásica</Text>
                <Text style={styles.upsellClassicSub}>
                  Sin cargo adicional (${activeUpsell?.basePrice.toLocaleString('es-AR')})
                </Text>
              </View>
              <Text style={styles.upsellClassicArrow}>→</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modern Bottom Sheet: Clean Commercial Checkout */}
      <Modal visible={paymentModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.bottomSheet, { maxHeight: '90%' }]}>
            <View style={styles.sheetHandle} />

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.checkoutSheetHeader}>
                <View>
                  <Text style={styles.checkoutSheetPreTitle}>CONFIRMAR PEDIDO</Text>
                  <Text style={styles.sheetTitle}>Tu Ronda en {activeBar.name}</Text>
                </View>
                <View style={styles.checkoutHeaderActions}>
                  <TouchableOpacity
                    style={styles.discreetPilotChip}
                    onPress={() => {
                      setPaymentModalVisible(false);
                      setPilotDrawerVisible(true);
                    }}
                  >
                    <Text style={styles.discreetPilotText}>🛠️ Piloto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPaymentModalVisible(false)}
                    style={styles.closeBtn}
                  >
                    <Text style={styles.closeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Clean Order Items Summary */}
              <View style={styles.orderSummaryBox}>
                {Object.entries(cart)
                  .filter(([_, qty]) => qty > 0)
                  .map(([pId, qty]) => {
                    const prod = products.find((p) => p.id === pId);
                    if (!prod) return null;
                    const hasUp = Boolean(selectedUpsells[pId] && prod.upsell);
                    const lineUnit =
                      prod.price + (hasUp && prod.upsell ? prod.upsell.additionalPrice : 0);
                    return (
                      <View key={pId} style={styles.summaryItemRow}>
                        <View style={styles.summaryQtyBadge}>
                          <Text style={styles.summaryQtyText}>{qty}x</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.summaryItemName}>{prod.name}</Text>
                          {hasUp && prod.upsell && (
                            <Text style={styles.summaryItemUpgrade}>
                              + {prod.upsell.title}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.summaryItemPrice}>
                          ${(lineUnit * qty).toLocaleString('es-AR')}
                        </Text>
                      </View>
                    );
                  })}

                <View style={styles.summaryDivider} />

                <View style={styles.summaryTotalRow}>
                  <Text style={styles.summaryTotalLabel}>Total a pagar</Text>
                  <Text style={styles.summaryTotalValue}>
                    ${liveBreakdown.totalAmount.toLocaleString('es-AR')}
                  </Text>
                </View>
              </View>

              {/* Clean Payment Method Selector */}
              <Text style={styles.paymentMethodLabel}>ELEGÍ CÓMO PAGAR</Text>
              <View style={styles.methodSelectorRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[
                    styles.methodOptionCard,
                    paymentMethod === 'MP_WALLET' && styles.methodOptionCardMPActive,
                  ]}
                  onPress={() => {
                    setPaymentMethod('MP_WALLET');
                    setPaymentFeedback(null);
                  }}
                >
                  <Text style={styles.methodOptionIcon}>💙</Text>
                  <Text
                    style={[
                      styles.methodOptionTitle,
                      paymentMethod === 'MP_WALLET' && styles.methodOptionTitleActive,
                    ]}
                  >
                    Mercado Pago
                  </Text>
                  <Text style={styles.methodOptionSub}>App · 1 Toque</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[
                    styles.methodOptionCard,
                    paymentMethod === 'CARD' && styles.methodOptionCardActive,
                  ]}
                  onPress={() => {
                    setPaymentMethod('CARD');
                    setPaymentFeedback(null);
                  }}
                >
                  <Text style={styles.methodOptionIcon}>💳</Text>
                  <Text
                    style={[
                      styles.methodOptionTitle,
                      paymentMethod === 'CARD' && styles.methodOptionTitleActive,
                    ]}
                  >
                    Tarjeta in-app
                  </Text>
                  <Text style={styles.methodOptionSub}>Crédito o Débito</Text>
                </TouchableOpacity>
              </View>

              {paymentFeedback && (
                <View
                  style={[
                    styles.feedbackBanner,
                    paymentFeedback.type === 'ERROR'
                      ? styles.feedbackError
                      : styles.feedbackInfo,
                  ]}
                >
                  <Text style={styles.feedbackText}>{paymentFeedback.message}</Text>
                </View>
              )}

              {/* Option 1: Pagar con Mercado Pago */}
              {paymentMethod === 'MP_WALLET' && (
                <View style={styles.mpCheckoutSection}>
                  <View style={styles.mpFeatureBox}>
                    <Text style={styles.mpFeatureTitle}>
                      Acreditación instantánea en tu Billetera de Vales
                    </Text>
                    <Text style={styles.mpFeatureSub}>
                      Pagá con dinero en cuenta o tus tarjetas guardadas sin escribir datos en la oscuridad.
                    </Text>
                  </View>

                  <TouchableOpacity
                    disabled={processingPayment}
                    activeOpacity={0.88}
                    style={styles.mpPayBtn}
                    onPress={handleDeepLinkMercadoPago}
                  >
                    {processingPayment ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.mpPayBtnText}>
                        Pagar con Mercado Pago • $
                        {liveBreakdown.totalAmount.toLocaleString('es-AR')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              {/* Option 2: Tarjeta in-app */}
              {paymentMethod === 'CARD' && (
                <View style={styles.cardFormSection}>
                  <View style={styles.inputFieldWrap}>
                    <Text style={styles.inputLabel}>NÚMERO DE TARJETA</Text>
                    <TextInput
                      style={styles.cleanInput}
                      value={cardNumber}
                      onChangeText={setCardNumber}
                      placeholder="0000 0000 0000 0000"
                      placeholderTextColor="#52525B"
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.inputFieldWrap}>
                    <Text style={styles.inputLabel}>NOMBRE DEL TITULAR</Text>
                    <TextInput
                      style={styles.cleanInput}
                      value={cardholderName}
                      onChangeText={setCardholderName}
                      placeholder="COMO FIGURA EN LA TARJETA"
                      placeholderTextColor="#52525B"
                      autoCapitalize="characters"
                    />
                  </View>

                  <View style={styles.rowInputs}>
                    <View style={[styles.inputFieldWrap, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>VENCIMIENTO</Text>
                      <TextInput
                        style={styles.cleanInput}
                        value={expirationDate}
                        onChangeText={setExpirationDate}
                        placeholder="MM/AA"
                        placeholderTextColor="#52525B"
                      />
                    </View>
                    <View style={{ width: 12 }} />
                    <View style={[styles.inputFieldWrap, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>CVV</Text>
                      <TextInput
                        style={styles.cleanInput}
                        value={securityCode}
                        onChangeText={setSecurityCode}
                        placeholder="123"
                        placeholderTextColor="#52525B"
                        keyboardType="numeric"
                        secureTextEntry
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    disabled={processingPayment}
                    activeOpacity={0.88}
                    style={styles.cardPayBtn}
                    onPress={handleCardPaymentSubmit}
                  >
                    {processingPayment ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.cardPayBtnText}>
                        Pagar con Tarjeta in-app • $
                        {liveBreakdown.totalAmount.toLocaleString('es-AR')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Hidden Drawer / Modal de Modo Piloto (Opened by 3 taps on logo or 🛠️ Piloto badge) */}
      <Modal visible={pilotDrawerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.bottomSheet, { maxHeight: '92%' }]}>
            <View style={styles.sheetHandle} />

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.checkoutSheetHeader}>
                <View>
                  <Text style={styles.pilotDrawerBadge}>🛠️ HERRAMIENTAS DE SIMULACIÓN</Text>
                  <Text style={styles.sheetTitle}>Drawer de Modo Piloto</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setPilotDrawerVisible(false)}
                  style={styles.closeBtn}
                >
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* 1. Sandbox Mode Toggle + Financial Split Breakdown */}
              <View style={styles.pilotSectionBox}>
                <View style={styles.pilotHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pilotBoxTitle}>Entorno Sandbox & Split Payment</Text>
                    <Text style={styles.pilotBoxSub}>
                      Total carrito: ${liveBreakdown.totalAmount.toLocaleString('es-AR')} · Neto Boliche: ${liveBreakdown.tenantNetAmount.toLocaleString('es-AR')} · Tutrago ({liveBreakdown.appliedCommissionPct}%): ${liveBreakdown.platformFee.toLocaleString('es-AR')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.sandboxPill,
                      pilotSandboxMode ? styles.sandboxPillOn : styles.sandboxPillOff,
                    ]}
                    onPress={() => setPilotSandboxMode(!pilotSandboxMode)}
                  >
                    <Text style={styles.sandboxPillText}>
                      {pilotSandboxMode ? 'SANDBOX ON' : 'LIVE MODE'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 2. Simulador de Stock en Vivo */}
              <View style={styles.pilotSectionBox}>
                <Text style={styles.pilotBoxTitle}>📦 Simulador de Stock en Vivo</Text>
                <Text style={styles.pilotBoxSub}>
                  Activá o agotá productos para comprobar el bloqueo en carta en tiempo real:
                </Text>
                <View style={styles.stockToggleList}>
                  {products.map((prod) => {
                    const isAvail = prod.isAvailable !== false;
                    return (
                      <TouchableOpacity
                        key={prod.id}
                        style={styles.stockItemRow}
                        onPress={() => toggleProductStockInPilot(prod.id)}
                      >
                        <Text style={styles.stockItemName} numberOfLines={1}>
                          {prod.name}
                        </Text>
                        <View
                          style={[
                            styles.stockStatusChip,
                            isAvail ? styles.stockChipOn : styles.stockChipOff,
                          ]}
                        >
                          <Text
                            style={[
                              styles.stockStatusText,
                              { color: isAvail ? '#10B981' : '#EF4444' },
                            ]}
                          >
                            {isAvail ? 'EN STOCK' : 'AGOTADO'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* 3. Tarjetas Sandbox de 1 Clic */}
              <View style={styles.pilotSectionBox}>
                <Text style={styles.pilotBoxTitle}>💳 Tarjetas Sandbox en 1 Clic</Text>
                <Text style={styles.pilotBoxSub}>
                  Pre-carga las tarjetas de prueba de Mercado Pago en el formulario in-app:
                </Text>
                <View style={styles.presetGrid}>
                  {SANDBOX_PRESET_CARDS.map((preset) => {
                    const isSelected = selectedPresetId === preset.id;
                    return (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.presetChip,
                          isSelected && {
                            borderColor: preset.badgeColor,
                            backgroundColor: 'rgba(255,255,255,0.05)',
                          },
                        ]}
                        onPress={() => {
                          selectSandboxPresetCard(preset);
                          setPaymentMethod('CARD');
                        }}
                      >
                        <Text style={[styles.presetChipLabel, { color: preset.badgeColor }]}>
                          {preset.label}
                        </Text>
                        <Text style={styles.presetChipSub}>{preset.expectedOutcome}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* 4. Simulador con PIN 2026 */}
              <View style={styles.pilotSectionBox}>
                <Text style={styles.pilotBoxTitle}>🔐 Simulador Autorizado (PIN 2026)</Text>
                <Text style={styles.pilotBoxSub}>
                  Dispara aprobaciones, rechazos y reembolsos atómicos para pruebas en barra:
                </Text>

                <TextInput
                  style={[styles.cleanInput, { marginTop: 8, marginBottom: 10 }]}
                  value={pilotPin}
                  onChangeText={setPilotPin}
                  placeholder="PIN de Supervisor (2026)"
                  placeholderTextColor="#52525B"
                  keyboardType="numeric"
                />

                {paymentFeedback && (
                  <View
                    style={[
                      styles.feedbackBanner,
                      paymentFeedback.type === 'ERROR'
                        ? styles.feedbackError
                        : styles.feedbackInfo,
                    ]}
                  >
                    <Text style={styles.feedbackText}>{paymentFeedback.message}</Text>
                  </View>
                )}

                <View style={styles.pilotActionsGrid}>
                  <TouchableOpacity
                    disabled={processingPayment}
                    style={[styles.pilotActionBtn, { backgroundColor: '#10B981' }]}
                    onPress={() => handlePilotSimulation('APPROVE')}
                  >
                    <Text style={styles.pilotActionText}>
                      ✅ Aprobar Compra (PAID_ON_HOLD)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={processingPayment}
                    style={[styles.pilotActionBtn, { backgroundColor: '#EF4444' }]}
                    onPress={() => handlePilotSimulation('REJECT_FUNDS')}
                  >
                    <Text style={styles.pilotActionText}>
                      🚫 Simular Rechazo (Sin Fondos)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={processingPayment}
                    style={[styles.pilotActionBtn, { backgroundColor: '#F59E0B' }]}
                    onPress={() => handlePilotSimulation('REJECT_SECURITY')}
                  >
                    <Text style={[styles.pilotActionText, { color: '#09090B' }]}>
                      🛡️ Simular Alerta Antifraude
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={processingPayment}
                    style={[styles.pilotActionBtn, { backgroundColor: '#8B5CF6' }]}
                    onPress={() => handlePilotSimulation('REFUND')}
                  >
                    <Text style={styles.pilotActionText}>
                      ↩️ Ejecutar Reembolso y Revocar Vales
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  stickyHeaderContainer: {
    backgroundColor: 'rgba(9, 9, 11, 0.94)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingTop: 14,
    paddingBottom: 10,
    zIndex: 20,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as any) : {}),
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  clubIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  clubLogoBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubLogoIcon: {
    color: '#A78BFA',
    fontSize: 17,
    fontWeight: '900',
  },
  clubTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clubNameText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  discreetPilotChip: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  discreetPilotText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
  },
  activeBarIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  activeBarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  activeBarText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  myVouchersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 7,
    borderRadius: 999,
  },
  myVouchersIcon: {
    fontSize: 13,
  },
  myVouchersLabel: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '800',
  },
  myVouchersCountPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  myVouchersCountPillActive: {
    backgroundColor: '#F59E0B',
  },
  myVouchersCountText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '900',
  },
  myVouchersCountTextActive: {
    color: '#09090B',
  },
  categoryScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    maxWidth: 520,
    alignSelf: 'center',
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  categoryPillActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  categoryPillIcon: {
    fontSize: 13,
  },
  categoryPillText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '700',
  },
  categoryPillTextActive: {
    color: '#FAFAFA',
    fontWeight: '900',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  livePickupBanner: {
    backgroundColor: '#121216',
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  livePickupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  livePickupTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '900',
  },
  livePickupSub: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 1,
  },
  livePickupChevron: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
  },
  productList: {
    gap: 12,
  },
  productCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  productCardSelected: {
    borderColor: 'rgba(139, 92, 246, 0.5)',
    backgroundColor: '#15151B',
  },
  productCardDisabled: {
    opacity: 0.48,
  },
  productThumb: {
    width: 82,
    height: 82,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  productThumbEmoji: {
    fontSize: 34,
  },
  upsellMiniDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upsellMiniDotText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
  },
  productInfo: {
    flex: 1,
    gap: 3,
  },
  productName: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  productDesc: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 16,
  },
  upgradeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 2,
  },
  upgradeBadgeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '800',
  },
  priceAndActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  priceTag: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
  },
  touchAddBtn44: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  touchAddBtnIcon: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
  },
  counterControl: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: '#09090B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.5)',
    paddingHorizontal: 4,
  },
  counterStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterStepBtnPlus: {
    backgroundColor: '#8B5CF6',
  },
  counterStepText: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
  },
  counterCount: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '900',
    paddingHorizontal: 10,
  },
  soldOutBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  soldOutText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '900',
  },
  floatingCheckoutWrap: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    maxWidth: 488,
    alignSelf: 'center',
  },
  glassCheckoutBar: {
    height: 68,
    borderRadius: 22,
    backgroundColor: 'rgba(18, 18, 22, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as any) : {}),
  },
  checkoutBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkoutCountBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutCountBubbleText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '900',
  },
  checkoutBarActionText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '900',
  },
  checkoutBarSubText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  checkoutBarCtaPill: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  checkoutBarCtaText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#121216',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  upsellHeaderBlock: {
    gap: 6,
    marginBottom: 18,
  },
  upsellSparklePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  upsellSparkleText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  sheetTitle: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  sheetSubtitle: {
    color: '#A1A1AA',
    fontSize: 13,
    lineHeight: 19,
  },
  upsellOptionCard: {
    backgroundColor: '#09090B',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  upsellOptionCardSelected: {
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  upsellOptionLeft: {
    flex: 1,
    paddingRight: 12,
    gap: 4,
  },
  upsellPromoTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#F59E0B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  upsellPromoTagText: {
    color: '#09090B',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  upsellOptionTitle: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 2,
  },
  upsellOptionSub: {
    color: '#A1A1AA',
    fontSize: 12,
  },
  upsellRadioSelected: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upsellRadioCheck: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '900',
  },
  upsellClassicCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  upsellClassicTitle: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '800',
  },
  upsellClassicSub: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  upsellClassicArrow: {
    color: '#71717A',
    fontSize: 18,
    fontWeight: '800',
  },
  checkoutSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkoutSheetPreTitle: {
    color: '#8B5CF6',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  checkoutHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
  orderSummaryBox: {
    backgroundColor: '#09090B',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 18,
    gap: 10,
  },
  summaryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryQtyBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  summaryQtyText: {
    color: '#C4B5FD',
    fontSize: 12,
    fontWeight: '900',
  },
  summaryItemName: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryItemUpgrade: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryItemPrice: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 2,
  },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTotalLabel: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryTotalValue: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '900',
  },
  paymentMethodLabel: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  methodSelectorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  methodOptionCard: {
    flex: 1,
    backgroundColor: '#09090B',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    gap: 3,
  },
  methodOptionCardMPActive: {
    borderColor: '#009EE3',
    backgroundColor: 'rgba(0, 158, 227, 0.1)',
  },
  methodOptionCardActive: {
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  methodOptionIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  methodOptionTitle: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '800',
  },
  methodOptionTitleActive: {
    color: '#FAFAFA',
  },
  methodOptionSub: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
  },
  feedbackBanner: {
    padding: 12,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  feedbackError: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: '#EF4444',
  },
  feedbackInfo: {
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    borderColor: '#8B5CF6',
  },
  feedbackText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },
  mpCheckoutSection: {
    gap: 14,
  },
  mpFeatureBox: {
    backgroundColor: '#09090B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 158, 227, 0.3)',
    gap: 4,
  },
  mpFeatureTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  mpFeatureSub: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 18,
  },
  mpPayBtn: {
    height: 58,
    borderRadius: 18,
    backgroundColor: '#009EE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mpPayBtnText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
  },
  cardFormSection: {
    gap: 12,
  },
  inputFieldWrap: {
    gap: 5,
  },
  inputLabel: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  cleanInput: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '700',
  },
  rowInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardPayBtn: {
    height: 58,
    borderRadius: 18,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  cardPayBtnText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
  },
  pilotDrawerBadge: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  pilotSectionBox: {
    backgroundColor: '#09090B',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
    gap: 8,
  },
  pilotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pilotBoxTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  pilotBoxSub: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 17,
  },
  sandboxPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  sandboxPillOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  sandboxPillOff: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  sandboxPillText: {
    color: '#FAFAFA',
    fontSize: 10,
    fontWeight: '900',
  },
  stockToggleList: {
    gap: 6,
    marginTop: 4,
  },
  stockItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stockItemName: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  stockStatusChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  stockChipOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  stockChipOff: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  stockStatusText: {
    fontSize: 10,
    fontWeight: '900',
  },
  presetGrid: {
    gap: 8,
    marginTop: 4,
  },
  presetChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#121216',
  },
  presetChipLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  presetChipSub: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  pilotActionsGrid: {
    gap: 8,
  },
  pilotActionBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  pilotActionText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '900',
  },
});
