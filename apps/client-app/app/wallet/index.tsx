import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  useWalletStore,
  DEFAULT_CLIENT_USER_ID,
  getConsumerAuthHeaders,
  ensureConsumerJwtSession,
} from '../../src/store/walletStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tutrago-api.onrender.com';

export default function WalletScreen() {
  const router = useRouter();
  const {
    user,
    venue,
    drinks,
    activeTicket,
    setActiveTicket,
    redeemDrinkLocally,
    lastOrderSummary,
    pilotSandboxMode,
    setPilotSandboxMode,
    revokeOrderDrinksLocally,
  } = useWalletStore();

  const resolvedUserId = user?.id || DEFAULT_CLIENT_USER_ID;

  const [selectedBar, setSelectedBar] = useState(
    venue.selectedBarId || '00000000-0000-4000-8000-000000000101'
  );
  // Pre-select 1 of the first available drink so the user can tap "Preparar Ahora" in 1 touch or adjust
  const [redeemQuantities, setRedeemQuantities] = useState<Record<string, number>>(() => {
    if (drinks.length > 0 && drinks[0].quantityRemaining > 0) {
      return { [drinks[0].orderItemId]: 1 };
    }
    return {};
  });
  const [loading, setLoading] = useState(false);

  // Discreet Pilot Drawer state (3 taps on header title or 🛠️ Piloto badge)
  const [pilotModalVisible, setPilotModalVisible] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHeaderTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setPilotModalVisible(true);
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 600);
  };

  const handleSimulateRefundFromWallet = async () => {
    if (!lastOrderSummary) return;
    try {
      await fetch(`${API_URL}/payments/pilot/simulate`, {
        method: 'POST',
        headers: getConsumerAuthHeaders(
          { 'Content-Type': 'application/json' },
          { userId: resolvedUserId, pilotPin: '2026' }
        ),
        body: JSON.stringify({
          orderId: lastOrderSummary.orderId,
          action: 'REFUND',
          pilotPin: '2026',
        }),
      });
    } catch {
      // Fallback local
    }
    revokeOrderDrinksLocally(lastOrderSummary.orderId);
    setRedeemQuantities({});
    setPilotModalVisible(false);
  };

  const bars = [
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

  const updateQuantity = (itemId: string, max: number, delta: number) => {
    const current = redeemQuantities[itemId] || 0;
    const next = Math.max(0, Math.min(max, current + delta));
    setRedeemQuantities((prev) => ({ ...prev, [itemId]: next }));
  };

  const totalSelectedToRedeem = Object.values(redeemQuantities).reduce((a, b) => a + b, 0);
  const totalAvailableInWallet = drinks.reduce((acc, d) => acc + d.quantityRemaining, 0);
  const selectedBarObj = bars.find((b) => b.id === selectedBar) || bars[0];

  // Acción principal: "Preparar Ahora"
  const handleActivatePickup = async () => {
    if (totalSelectedToRedeem === 0) return;
    setLoading(true);

    const itemsToRedeem = Object.entries(redeemQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const d = drinks.find((drink) => drink.orderItemId === itemId)!;
        return {
          orderItemId: d.orderItemId,
          quantityToRedeem: qty,
          name: d.productName,
        };
      });

    let newTicket: any = null;

    try {
      const token = await ensureConsumerJwtSession(API_URL);
      const response = await fetch(`${API_URL}/pickup/request`, {
        method: 'POST',
        headers: getConsumerAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `pickup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          },
          { userId: resolvedUserId, token }
        ),
        body: JSON.stringify({
          userId: resolvedUserId,
          barId: selectedBar,
          items: itemsToRedeem.map((i) => ({
            orderItemId: i.orderItemId,
            quantityToRedeem: i.quantityToRedeem,
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        newTicket = {
          ticketId: data.ticketId,
          shortCode: data.shortCode,
          securityColor: data.securityColor,
          status: data.status || 'IN_PREPARATION',
          offlineQrToken: data.offlineQrToken,
          barName: data.barName || selectedBarObj?.name || 'Barra Pista Central',
          items: (data.items || itemsToRedeem).map((i: any) => ({
            name: i.name,
            quantity: i.quantity || i.quantityToRedeem,
          })),
          activatedAt: data.activatedAt || new Date().toISOString(),
        };
      }
    } catch {
      // Continúa con fallback offline-first si el usuario perdió señal
    }

    if (!newTicket) {
      const shortCode = 'A' + Math.floor(Math.random() * 90 + 10);
      const securityColors = ['#10B981', '#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6'];
      const securityColor = securityColors[Math.floor(Math.random() * securityColors.length)];
      const ticketId = `ticket-${Date.now()}`;
      const offlineQrToken = `jwt.offline.${ticketId}.${shortCode}`;

      newTicket = {
        ticketId,
        shortCode,
        securityColor,
        status: 'IN_PREPARATION' as const,
        offlineQrToken,
        barName: selectedBarObj?.name || 'Barra Pista Central',
        items: itemsToRedeem.map((i) => ({ name: i.name, quantity: i.quantityToRedeem })),
        activatedAt: new Date().toISOString(),
      };
    }

    for (const item of itemsToRedeem) {
      redeemDrinkLocally(item.orderItemId, item.quantityToRedeem);
    }

    setActiveTicket(newTicket);
    setLoading(false);

    router.push(`/ticket/${newTicket.ticketId}`);
  };

  return (
    <View style={styles.container}>
      {/* Compact Top Navigation Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backBtn}
          onPress={() =>
            router.push({
              pathname: '/(club)/[tenantId]',
              params: { tenantId: venue.tenantSlug || 'club-tutrago', bar: selectedBar },
            })
          }
        >
          <Text style={styles.backBtnText}>← Carta</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleHeaderTap}
          style={styles.headerCenterTitleWrap}
        >
          <Text style={styles.headerLabel}>APPLE WALLET STYLE</Text>
          <Text style={styles.headerTitle}>Mis Vales</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.75}
          style={styles.pilotBadge}
          onPress={() => setPilotModalVisible(true)}
        >
          <Text style={styles.pilotBadgeText}>🛠️ Piloto</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Pickup Ticket Banner if active */}
        {activeTicket && activeTicket.status !== 'DELIVERED' && (
          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.activePickupCard,
              { borderColor: activeTicket.securityColor || '#10B981' },
            ]}
            onPress={() => router.push(`/ticket/${activeTicket.ticketId}`)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.activePickupTag}>⚡ RETIRO EN CURSO</Text>
              <Text style={styles.activePickupTitle}>
                Turno #{activeTicket.shortCode} · {activeTicket.barName}
              </Text>
              <Text style={styles.activePickupSub}>
                Tocá para abrir el cartel luminoso a pantalla completa
              </Text>
            </View>
            <View
              style={[
                styles.activePickupCodeChip,
                { backgroundColor: activeTicket.securityColor || '#10B981' },
              ]}
            >
              <Text style={styles.activePickupCodeText}>#{activeTicket.shortCode}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Elegant Bar Selector */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Barra de Retiro</Text>
            <Text style={styles.sectionHint}>Elegí dónde retirar ahora</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.barSelectorScroll}
          >
            {bars.map((bar) => {
              const isSelected = selectedBar === bar.id;
              return (
                <TouchableOpacity
                  key={bar.id}
                  activeOpacity={0.85}
                  onPress={() => setSelectedBar(bar.id)}
                  style={[styles.barSelectorCard, isSelected && styles.barSelectorCardActive]}
                >
                  <View style={styles.barCardTopRow}>
                    <View
                      style={[
                        styles.barRadioDot,
                        isSelected && styles.barRadioDotActive,
                      ]}
                    />
                    <View style={styles.barWaitPill}>
                      <Text style={styles.barWaitPillText}>{bar.wait}</Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.barSelectorName,
                      isSelected && styles.barSelectorNameActive,
                    ]}
                  >
                    {bar.name}
                  </Text>
                  <Text style={styles.barSelectorTag}>{bar.tag}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Digital Passes Section (Apple Wallet / Physical Ticket Style with Lateral Cutouts) */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              Pases Digitales ({totalAvailableInWallet})
            </Text>
            <Text style={styles.sectionHint}>Canje parcial o total</Text>
          </View>

          {drinks.length === 0 ? (
            <View style={styles.emptyWalletCard}>
              <Text style={styles.emptyWalletEmoji}>🎟️</Text>
              <Text style={styles.emptyWalletTitle}>No tenés vales pendientes</Text>
              <Text style={styles.emptyWalletSub}>
                Comprá tus tragos desde la carta y guardalos acá para retirarlos sin hacer fila.
              </Text>
              <TouchableOpacity
                activeOpacity={0.88}
                style={styles.browseCatalogBtn}
                onPress={() =>
                  router.push({
                    pathname: '/(club)/[tenantId]',
                    params: { tenantId: venue.tenantSlug || 'club-tutrago', bar: selectedBar },
                  })
                }
              >
                <Text style={styles.browseCatalogBtnText}>Explorar Carta de la Barra</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.passesStack}>
              {drinks.map((item, idx) => {
                const qtyToRedeem = redeemQuantities[item.orderItemId] || 0;
                const isSelectedForPickup = qtyToRedeem > 0;
                const accentColors = ['#8B5CF6', '#F59E0B', '#10B981', '#3B82F6'];
                const passAccent = accentColors[idx % accentColors.length];

                return (
                  <View
                    key={item.orderItemId}
                    style={[
                      styles.ticketPassCard,
                      isSelectedForPickup && {
                        borderColor: passAccent,
                        backgroundColor: '#15151C',
                      },
                    ]}
                  >
                    {/* Top Colored Accent Strip */}
                    <View
                      style={[styles.passTopColorBar, { backgroundColor: passAccent }]}
                    />

                    {/* Upper Part of Digital Pass */}
                    <View style={styles.passUpperSection}>
                      <View style={styles.passMetaRow}>
                        <View style={styles.passVerifiedBadge}>
                          <View
                            style={[styles.passDot, { backgroundColor: passAccent }]}
                          />
                          <Text style={styles.passVerifiedText}>
                            PASE DIGITAL · PAGADO
                          </Text>
                        </View>
                        <View style={styles.remainingCountBadge}>
                          <Text style={styles.remainingCountText}>
                            {item.quantityRemaining} DISP.
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.passDrinkTitle}>{item.productName}</Text>
                      <Text style={styles.passVenueSub}>
                        Válido en {venue.tenantName} · Retiro sin vencimiento esta noche
                      </Text>
                    </View>

                    {/* Ticket Perforation Divider with Lateral Cutouts (Troquelado) */}
                    <View style={styles.perforationRow}>
                      <View style={styles.cutoutLeft} />
                      <View style={styles.dashedLineContainer}>
                        {Array.from({ length: 22 }).map((_, dashIdx) => (
                          <View key={dashIdx} style={styles.dashSegment} />
                        ))}
                      </View>
                      <View style={styles.cutoutRight} />
                    </View>

                    {/* Lower Stub of Digital Pass: Quantity Selector to Prepare Now */}
                    <View style={styles.passLowerStub}>
                      <View>
                        <Text style={styles.stubLabel}>PREPARAR AHORA</Text>
                        <Text style={styles.stubValueText}>
                          {qtyToRedeem > 0
                            ? `${qtyToRedeem} de ${item.quantityRemaining} seleccionados`
                            : 'Tocá + para retirar en barra'}
                        </Text>
                      </View>

                      <View style={styles.passCounterWrap}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          style={styles.passCounterBtn}
                          onPress={() =>
                            updateQuantity(item.orderItemId, item.quantityRemaining, -1)
                          }
                        >
                          <Text style={styles.passCounterBtnText}>−</Text>
                        </TouchableOpacity>

                        <Text
                          style={[
                            styles.passCounterQty,
                            qtyToRedeem > 0 && { color: '#FAFAFA' },
                          ]}
                        >
                          {qtyToRedeem}
                        </Text>

                        <TouchableOpacity
                          activeOpacity={0.8}
                          style={[
                            styles.passCounterBtn,
                            styles.passCounterBtnPlus,
                            { backgroundColor: passAccent },
                          ]}
                          onPress={() =>
                            updateQuantity(item.orderItemId, item.quantityRemaining, 1)
                          }
                        >
                          <Text
                            style={[
                              styles.passCounterBtnText,
                              passAccent === '#F59E0B' && { color: '#09090B' },
                            ]}
                          >
                            +
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Prominent Floating Bottom Bar: "Preparar Ahora" */}
      {drinks.length > 0 && (
        <View style={styles.floatingActionWrap}>
          <View style={styles.glassBottomBar}>
            <View style={styles.bottomBarMeta}>
              <Text style={styles.bottomBarTitle}>
                {totalSelectedToRedeem > 0
                  ? `${totalSelectedToRedeem} ${
                      totalSelectedToRedeem === 1 ? 'trago listo' : 'tragos listos'
                    } para enviar`
                  : 'Seleccioná qué trago preparar'}
              </Text>
              <Text style={styles.bottomBarSub}>
                📍 {selectedBarObj.name} ({selectedBarObj.wait})
              </Text>
            </View>

            <TouchableOpacity
              disabled={loading || totalSelectedToRedeem === 0}
              activeOpacity={0.88}
              style={[
                styles.prepareNowBtn,
                totalSelectedToRedeem === 0 && styles.prepareNowBtnDisabled,
              ]}
              onPress={handleActivatePickup}
            >
              {loading ? (
                <ActivityIndicator color="#09090B" />
              ) : (
                <Text style={styles.prepareNowBtnText}>
                  Preparar Ahora {totalSelectedToRedeem > 0 ? `(${totalSelectedToRedeem})` : ''} →
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Hidden Pilot / Dev Modal for Split Payment Audit & Refund Simulation */}
      <Modal visible={pilotModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.pilotSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.pilotHeaderRow}>
              <View>
                <Text style={styles.pilotBadgeLabel}>🛠️ MODO PILOTO · BILLETERA</Text>
                <Text style={styles.pilotSheetTitle}>Auditoría & Simulador</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setPilotModalVisible(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {lastOrderSummary ? (
              <View style={styles.pilotAuditCard}>
                <Text style={styles.pilotAuditBadge}>
                  {lastOrderSummary.paymentStatus === 'PAID_ON_HOLD'
                    ? '✅ ORDEN EN PAID_ON_HOLD (SPLIT PAYMENT)'
                    : '↩️ ORDEN REEMBOLSADA (CANCELLED_REFUNDED)'}
                </Text>
                <Text style={styles.pilotAuditText}>
                  Orden #{lastOrderSummary.orderId.slice(0, 8)} · Total: $
                  {lastOrderSummary.totalAmount.toLocaleString('es-AR')}
                </Text>
                <Text style={styles.pilotAuditText}>
                  Neto Boliche: ${lastOrderSummary.tenantNetAmount.toLocaleString('es-AR')} ·
                  Tutrago ({lastOrderSummary.appliedCommissionPct}%): $
                  {lastOrderSummary.platformFee.toLocaleString('es-AR')} · Pasarela (
                  {lastOrderSummary.appliedGatewayFeePct}%): $
                  {lastOrderSummary.gatewayFee.toLocaleString('es-AR')}
                </Text>

                {lastOrderSummary.paymentStatus === 'PAID_ON_HOLD' && (
                  <TouchableOpacity
                    style={styles.pilotRefundBtn}
                    onPress={handleSimulateRefundFromWallet}
                  >
                    <Text style={styles.pilotRefundBtnText}>
                      🧪 [PIN 2026] Simular Reembolso y Revocar Vales
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.pilotAuditCard}>
                <Text style={styles.pilotAuditText}>
                  Vales precargados en estado PAID_ON_HOLD listos para pruebas de retiro parcial o total.
                </Text>
              </View>
            )}

            <View style={styles.pilotAuditCard}>
              <View style={styles.pilotHeaderRow}>
                <Text style={styles.pilotAuditTitle}>Modo Sandbox</Text>
                <TouchableOpacity
                  style={styles.sandboxToggle}
                  onPress={() => setPilotSandboxMode(!pilotSandboxMode)}
                >
                  <Text style={styles.sandboxToggleText}>
                    {pilotSandboxMode ? 'ACTIVO' : 'LIVE'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#09090B',
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  backBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  backBtnText: {
    color: '#D4D4D8',
    fontSize: 12,
    fontWeight: '800',
  },
  headerCenterTitleWrap: {
    alignItems: 'center',
  },
  headerLabel: {
    color: '#8B5CF6',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  pilotBadge: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pilotBadgeText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 130,
    gap: 22,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  activePickupCard: {
    backgroundColor: '#121216',
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activePickupTag: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  activePickupTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  activePickupSub: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  activePickupCodeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  activePickupCodeText: {
    color: '#09090B',
    fontSize: 18,
    fontWeight: '900',
  },
  sectionBlock: {
    gap: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionTitle: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
  },
  sectionHint: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  barSelectorScroll: {
    gap: 10,
  },
  barSelectorCard: {
    width: 164,
    backgroundColor: '#121216',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  barSelectorCardActive: {
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  barCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  barRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#52525B',
  },
  barRadioDotActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#C4B5FD',
  },
  barWaitPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  barWaitPillText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
  },
  barSelectorName: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  barSelectorNameActive: {
    color: '#FAFAFA',
  },
  barSelectorTag: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
  },
  passesStack: {
    gap: 16,
  },
  ticketPassCard: {
    backgroundColor: '#121216',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  passTopColorBar: {
    height: 6,
    width: '100%',
  },
  passUpperSection: {
    padding: 18,
    paddingBottom: 14,
    gap: 6,
  },
  passMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  passVerifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  passVerifiedText: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  remainingCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  remainingCountText: {
    color: '#FAFAFA',
    fontSize: 11,
    fontWeight: '900',
  },
  passDrinkTitle: {
    color: '#FAFAFA',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  passVenueSub: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  perforationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
    position: 'relative',
  },
  cutoutLeft: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#09090B',
    marginLeft: -12,
    borderRightWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dashedLineContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  dashSegment: {
    width: 6,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  cutoutRight: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#09090B',
    marginRight: -12,
    borderLeftWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  passLowerStub: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stubLabel: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  stubValueText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  passCounterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#09090B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 4,
  },
  passCounterBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passCounterBtnPlus: {
    backgroundColor: '#8B5CF6',
  },
  passCounterBtnText: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
  },
  passCounterQty: {
    color: '#71717A',
    fontSize: 16,
    fontWeight: '900',
    paddingHorizontal: 12,
  },
  emptyWalletCard: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#121216',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  emptyWalletEmoji: {
    fontSize: 36,
    marginBottom: 4,
  },
  emptyWalletTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyWalletSub: {
    color: '#A1A1AA',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 10,
  },
  browseCatalogBtn: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#8B5CF6',
  },
  browseCatalogBtnText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '900',
  },
  floatingActionWrap: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    maxWidth: 488,
    alignSelf: 'center',
  },
  glassBottomBar: {
    backgroundColor: 'rgba(18, 18, 22, 0.92)',
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as any) : {}),
  },
  bottomBarMeta: {
    flex: 1,
  },
  bottomBarTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '900',
  },
  bottomBarSub: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  prepareNowBtn: {
    height: 50,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prepareNowBtnDisabled: {
    backgroundColor: '#27272A',
  },
  prepareNowBtnText: {
    color: '#09090B',
    fontSize: 14,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'flex-end',
  },
  pilotSheet: {
    backgroundColor: '#121216',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 14,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
  },
  pilotHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pilotBadgeLabel: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  pilotSheetTitle: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '900',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  pilotAuditCard: {
    backgroundColor: '#09090B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  pilotAuditBadge: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '900',
  },
  pilotAuditTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  pilotAuditText: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 18,
  },
  pilotRefundBtn: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    alignItems: 'center',
  },
  pilotRefundBtnText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '900',
  },
  sandboxToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  sandboxToggleText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '900',
  },
});
