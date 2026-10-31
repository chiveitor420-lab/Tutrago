import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore } from '../src/store/walletStore';

export default function IndexScreen() {
  const router = useRouter();
  const {
    user,
    venue,
    drinks,
    activeTicket,
    bars,
    pilotSandboxMode,
    setPilotSandboxMode,
  } = useWalletStore();

  const [pilotModalVisible, setPilotModalVisible] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoTap = () => {
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

  const totalAvailableDrinks = drinks.reduce((acc, d) => acc + d.quantityRemaining, 0);

  return (
    <View style={styles.container}>
      {/* Ambient OLED Glow */}
      <View pointerEvents="none" style={styles.ambientGlowTop} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Navbar: Logo (3-tap trigger) + Discreet Pilot Badge */}
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleLogoTap}
            style={styles.brandRow}
          >
            <View style={styles.brandOrb}>
              <Text style={styles.brandOrbIcon}>✦</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>TUTRAGO</Text>
              <Text style={styles.brandSub}>{venue.tenantName}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.topRightActions}>
            {user && (
              <View style={styles.userPill}>
                <View style={styles.onlineDot} />
                <Text style={styles.userPillText} numberOfLines={1}>
                  {user.fullName}
                </Text>
              </View>
            )}
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.pilotBadgeBtn}
              onPress={() => setPilotModalVisible(true)}
            >
              <Text style={styles.pilotBadgeText}>🛠️ Piloto</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero Section */}
        <View style={styles.heroCard}>
          <View style={styles.heroLiveTag}>
            <View style={styles.heroPulseDot} />
            <Text style={styles.heroLiveTagText}>BARRAS ACTIVAS ESTA NOCHE</Text>
          </View>

          <Text style={styles.heroHeading}>
            Pedí desde la pista.{'\n'}
            <Text style={styles.heroHeadingAccent}>Retirá sin fila.</Text>
          </Text>

          <Text style={styles.heroDescription}>
            Comprá tus tragos en segundos, guardalos en tu billetera digital y retiralos cuando quieras con tu código luminoso.
          </Text>

          {/* Primary CTA */}
          <TouchableOpacity
            activeOpacity={0.88}
            style={styles.primaryCta}
            onPress={() =>
              router.push({
                pathname: '/(club)/[tenantId]',
                params: { tenantId: venue.tenantSlug || 'club-tutrago', bar: bars[0].id },
              })
            }
          >
            <Text style={styles.primaryCtaText}>Entrar a la Carta</Text>
            <View style={styles.primaryCtaArrowBox}>
              <Text style={styles.primaryCtaArrow}>→</Text>
            </View>
          </TouchableOpacity>

          {/* Secondary Wallet CTA */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.walletCta}
            onPress={() => router.push('/wallet')}
          >
            <View style={styles.walletCtaLeft}>
              <Text style={styles.walletCtaIcon}>🎟️</Text>
              <View>
                <Text style={styles.walletCtaTitle}>Mis Vales en Billetera</Text>
                <Text style={styles.walletCtaSub}>
                  Listos para canjear en cualquier barra
                </Text>
              </View>
            </View>
            <View style={styles.walletCountBadge}>
              <Text style={styles.walletCountText}>{totalAvailableDrinks}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Active Ticket Banner if present */}
        {activeTicket && activeTicket.status !== 'DELIVERED' && (
          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.activeTicketCard,
              { borderColor: activeTicket.securityColor || '#8B5CF6' },
            ]}
            onPress={() => router.push(`/ticket/${activeTicket.ticketId}`)}
          >
            <View style={styles.ticketRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.ticketLiveBadgeRow}>
                  <View
                    style={[
                      styles.ticketStatusDot,
                      { backgroundColor: activeTicket.securityColor || '#10B981' },
                    ]}
                  />
                  <Text style={styles.ticketBadge}>
                    {activeTicket.status === 'READY_FOR_PICKUP'
                      ? '¡PEDIDO LISTO EN BARRA!'
                      : 'PREPARANDO TU PEDIDO'}
                  </Text>
                </View>
                <Text style={styles.ticketTitle}>{activeTicket.barName}</Text>
                <Text style={styles.ticketSub}>
                  Tocá para mostrar tu código en ventanilla rápida
                </Text>
              </View>
              <View
                style={[
                  styles.ticketCodePill,
                  { backgroundColor: activeTicket.securityColor || '#10B981' },
                ]}
              >
                <Text style={styles.ticketCodePillText}>#{activeTicket.shortCode}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Bar Selector Section (Clean Commercial View) */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Elegí tu sector actual</Text>
            <Text style={styles.sectionSubtitle}>Tiempo estimado en vivo</Text>
          </View>

          <View style={styles.barsList}>
            {bars.map((bar) => (
              <TouchableOpacity
                key={bar.id}
                activeOpacity={0.85}
                style={styles.barCard}
                onPress={() =>
                  router.push({
                    pathname: '/v/[tenantId]',
                    params: { tenantId: 'club-tutrago', bar: bar.id },
                  })
                }
              >
                <View style={styles.barIconBox}>
                  <Text style={styles.barIconText}>🍸</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.barTitleRow}>
                    <Text style={styles.barName}>{bar.name}</Text>
                    <View style={styles.barTagPill}>
                      <Text style={styles.barTagText}>{bar.tag}</Text>
                    </View>
                  </View>
                  <Text style={styles.barHint}>Retiro express por ventanilla</Text>
                </View>
                <View style={styles.waitBadge}>
                  <Text style={styles.waitBadgeValue}>{bar.wait}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.footerNote}>
          Pagos procesados de forma segura con Mercado Pago. Tus vales quedan guardados en tu teléfono incluso sin señal.
        </Text>
      </ScrollView>

      {/* Hidden Pilot / Dev Drawer Modal */}
      <Modal visible={pilotModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.pilotDrawer}>
            <View style={styles.sheetHandle} />
            <View style={styles.pilotHeaderRow}>
              <View>
                <Text style={styles.pilotDrawerTag}>MODO PILOTO & QA</Text>
                <Text style={styles.pilotDrawerTitle}>Simulador de Entorno</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setPilotModalVisible(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.pilotCard}>
              <View style={styles.pilotRowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.pilotItemTitle}>Entorno Sandbox Mercado Pago</Text>
                  <Text style={styles.pilotItemSub}>
                    Habilita tarjetas de prueba en 1 clic y acreditación inmediata
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    pilotSandboxMode ? styles.toggleBtnOn : styles.toggleBtnOff,
                  ]}
                  onPress={() => setPilotSandboxMode(!pilotSandboxMode)}
                >
                  <Text style={styles.toggleBtnText}>
                    {pilotSandboxMode ? 'ACTIVO' : 'LIVE'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.pilotSectionLabel}>
              SIMULAR ESCANEO DE QR FÍSICO POR BARRA
            </Text>
            <View style={styles.pilotQrList}>
              {bars.map((bar) => (
                <TouchableOpacity
                  key={bar.id}
                  style={styles.pilotQrBtn}
                  onPress={() => {
                    setPilotModalVisible(false);
                    router.push({
                      pathname: '/v/[tenantId]',
                      params: { tenantId: 'club-tutrago', bar: bar.id },
                    });
                  }}
                >
                  <Text style={styles.pilotQrBtnTitle}>📷 QR {bar.name}</Text>
                  <Text style={styles.pilotQrBtnCode}>
                    /v/club-tutrago?bar={bar.id.slice(-3)}
                  </Text>
                </TouchableOpacity>
              ))}
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
  ambientGlowTop: {
    position: 'absolute',
    top: -120,
    left: '10%',
    right: '10%',
    height: 260,
    borderRadius: 999,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(70px)' } as any) : {}),
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
    gap: 22,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandOrb: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandOrbIcon: {
    color: '#A78BFA',
    fontSize: 16,
    fontWeight: '900',
  },
  brandTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  brandSub: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: 130,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  userPillText: {
    color: '#E4E4E7',
    fontSize: 11,
    fontWeight: '700',
  },
  pilotBadgeBtn: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pilotBadgeText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: '#121216',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 16,
  },
  heroLiveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  heroPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
  },
  heroLiveTagText: {
    color: '#C4B5FD',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroHeading: {
    color: '#FAFAFA',
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  heroHeadingAccent: {
    color: '#8B5CF6',
  },
  heroDescription: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  primaryCta: {
    height: 58,
    borderRadius: 16,
    backgroundColor: '#8B5CF6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  primaryCtaText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  primaryCtaArrowBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(9, 9, 11, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCtaArrow: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
  },
  walletCta: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletCtaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  walletCtaIcon: {
    fontSize: 22,
  },
  walletCtaTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  walletCtaSub: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 1,
  },
  walletCountBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  walletCountText: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '900',
  },
  activeTicketCard: {
    backgroundColor: '#121216',
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 16,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ticketLiveBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ticketStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ticketBadge: {
    color: '#E4E4E7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  ticketTitle: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 4,
  },
  ticketSub: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  ticketCodePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  ticketCodePillText: {
    color: '#09090B',
    fontSize: 20,
    fontWeight: '900',
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionTitle: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  barsList: {
    gap: 10,
  },
  barCard: {
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barIconText: {
    fontSize: 20,
  },
  barTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  barName: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
  barTagPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  barTagText: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '700',
  },
  barHint: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  waitBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  waitBadgeValue: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  footerNote: {
    color: '#52525B',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'flex-end',
  },
  pilotDrawer: {
    backgroundColor: '#121216',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 14,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 4,
  },
  pilotHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pilotDrawerTag: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  pilotDrawerTitle: {
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
  pilotCard: {
    backgroundColor: '#09090B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pilotRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pilotItemTitle: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  pilotItemSub: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  toggleBtnOn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  toggleBtnOff: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  toggleBtnText: {
    color: '#FAFAFA',
    fontSize: 11,
    fontWeight: '900',
  },
  pilotSectionLabel: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  pilotQrList: {
    gap: 8,
  },
  pilotQrBtn: {
    backgroundColor: '#09090B',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pilotQrBtnTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '800',
  },
  pilotQrBtnCode: {
    color: '#8B5CF6',
    fontSize: 11,
    fontWeight: '700',
  },
});
