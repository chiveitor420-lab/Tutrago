import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  useWalletStore,
  OfflineSavedTicket,
  createOfflineJwtSimulation,
  getConsumerAuthHeaders,
} from '../../src/store/walletStore';
import { SECURITY_COLORS } from '@tutrago/shared-types';
import * as Haptics from 'expo-haptics';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tutrago-api.onrender.com';
const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'wss://tutrago-api.onrender.com';

export default function AntiNoiseTicketScreen() {
  const router = useRouter();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const {
    activeTicket,
    ticketHistory,
    setActiveTicket,
    updateActiveTicketStatus,
  } = useWalletStore();

  const resolvedInitialTicket: OfflineSavedTicket =
    (activeTicket && (!ticketId || activeTicket.ticketId === String(ticketId))
      ? activeTicket
      : ticketHistory.find((t) => t.ticketId === String(ticketId))) ||
    activeTicket || {
      ticketId: String(ticketId || 'ticket-offline-demo'),
      shortCode: 'A47',
      securityColor: '#10B981',
      status: 'READY_FOR_PICKUP',
      barId: '00000000-0000-4000-8000-000000000101',
      barName: 'Barra Pista Central',
      items: [
        { name: 'Fernet Branca con Coca-Cola (Doble Medida)', quantity: 2 },
        { name: 'Gin Tonic Beefeater', quantity: 1 },
      ],
      offlineQrToken: createOfflineJwtSimulation({
        ticketId: String(ticketId || 'ticket-offline-demo'),
        shortCode: 'A47',
        barId: '00000000-0000-4000-8000-000000000101',
        securityColor: '#10B981',
        items: [{ name: 'Fernet Branca con Coca-Cola', quantity: 2 }],
      }),
      activatedAt: new Date().toISOString(),
    };

  const [ticket, setTicket] = useState<OfflineSavedTicket>(resolvedInitialTicket);
  const [timeString, setTimeString] = useState('');
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Discreet Pilot Drawer state (opened by 3 taps on header or 🛠️ Piloto badge)
  const [pilotDrawerVisible, setPilotDrawerVisible] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHeaderTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setPilotDrawerVisible(true);
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 600);
  };

  // Animación continua 60 FPS (funciona 100% sin red para evitar fraude por captura de pantalla)
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scannerWaveAnim = useRef(new Animated.Value(0)).current;

  const triggerStrongHaptics = () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Fallback Web Vibration API
    }
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([250, 100, 250, 100, 400]);
      } catch {
        // Ignore on desktop browsers
      }
    }
  };

  useEffect(() => {
    setActiveTicket(ticket);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(scannerWaveAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(scannerWaveAnim, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    ).start();

    const clockInterval = setInterval(() => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
      setTimeString(`${h}:${m}:${s}.${ms}`);
    }, 45);

    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    if (ticket.status === 'READY_FOR_PICKUP') {
      triggerStrongHaptics();
    }
  }, [ticket.status]);

  useEffect(() => {
    const currentId = ticket.ticketId;
    if (!currentId) return;

    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      setIsOfflineMode(false);
      socket.emit('join:ticket', { ticketId: currentId });
    });

    socket.on('connect_error', () => {
      setIsOfflineMode(true);
    });

    const handleStatusUpdate = (payload: any) => {
      if (payload?.status) {
        setTicket((prev) => {
          const updated: OfflineSavedTicket = {
            ...prev,
            status: payload.status,
            securityColor: payload.securityColor || prev.securityColor,
            shortCode: payload.shortCode || prev.shortCode,
          };
          setActiveTicket(updated);
          return updated;
        });
      }
    };

    socket.on('ticket:ready_vibrate', handleStatusUpdate);
    socket.on('ticket:status_changed', handleStatusUpdate);

    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/pickup/ticket/${currentId}`, {
          headers: getConsumerAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.status && data.status !== ticket.status) {
            handleStatusUpdate(data);
          }
        }
      } catch {
        setIsOfflineMode(true);
      }
    }, 3500);

    return () => {
      socket.disconnect();
      clearInterval(pollTimer);
    };
  }, [ticket.ticketId]);

  const handleTransitionStatus = (nextStatus: OfflineSavedTicket['status']) => {
    const updated: OfflineSavedTicket = {
      ...ticket,
      status: nextStatus,
      readyAt: nextStatus === 'READY_FOR_PICKUP' ? new Date().toISOString() : ticket.readyAt,
    };
    setTicket(updated);
    setActiveTicket(updated);
    updateActiveTicketStatus(nextStatus);
    if (nextStatus === 'READY_FOR_PICKUP') {
      triggerStrongHaptics();
    }
  };

  const handleCycleSecurityColor = () => {
    const currentIdx = SECURITY_COLORS.indexOf(ticket.securityColor as any);
    const nextColor = SECURITY_COLORS[(currentIdx + 1) % SECURITY_COLORS.length];
    const updated: OfflineSavedTicket = {
      ...ticket,
      securityColor: nextColor,
    };
    setTicket(updated);
    setActiveTicket(updated);
  };

  const isQueued = ticket.status === 'PREP_REQUESTED';
  const isPrep = ticket.status === 'IN_PREPARATION';
  const isReady = ticket.status === 'READY_FOR_PICKUP';

  const backgroundColor = isReady ? ticket.securityColor : '#09090B';
  const primaryTextColor = isReady ? '#09090B' : '#FAFAFA';
  const secondaryTextColor = isReady ? 'rgba(9, 9, 11, 0.76)' : '#A1A1AA';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {/* Top 60FPS Kinetic Security Pulse Bar */}
      <View style={styles.antiFraudTrack}>
        <Animated.View
          style={[
            styles.antiFraudPulseBar,
            {
              backgroundColor: isReady ? '#09090B' : ticket.securityColor,
              opacity: pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1],
              }),
              transform: [
                {
                  scaleX: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Navigation & Live Clock Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[
              styles.backPill,
              isReady && {
                backgroundColor: 'rgba(9,9,11,0.16)',
                borderColor: 'rgba(9,9,11,0.25)',
              },
            ]}
            onPress={() => router.push('/wallet')}
          >
            <Text style={[styles.backPillText, { color: primaryTextColor }]}>
              ← Mis Vales
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleHeaderTap}
            style={[
              styles.clockPill,
              isReady && { backgroundColor: 'rgba(9, 9, 11, 0.18)' },
            ]}
          >
            <View
              style={[
                styles.livePulseDot,
                { backgroundColor: isReady ? '#09090B' : ticket.securityColor },
              ]}
            />
            <Text style={[styles.liveClock, { color: primaryTextColor }]}>
              {timeString}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[
              styles.pilotCornerChip,
              isReady && {
                backgroundColor: 'rgba(9,9,11,0.16)',
                borderColor: 'rgba(9,9,11,0.25)',
              },
            ]}
            onPress={() => setPilotDrawerVisible(true)}
          >
            <Text style={[styles.pilotCornerText, { color: secondaryTextColor }]}>
              🛠️ Piloto
            </Text>
          </TouchableOpacity>
        </View>

        {/* Assigned Bar & 3-Step Turn Status Stepper (En Cola -> Preparando -> ¡Listo en Barra!) */}
        <View style={styles.barAndStepperBox}>
          <Text style={[styles.barNameTitle, { color: primaryTextColor }]}>
            📍 {ticket.barName}
          </Text>

          <View
            style={[
              styles.stepperTrack,
              isReady && {
                backgroundColor: 'rgba(9, 9, 11, 0.14)',
                borderColor: 'rgba(9, 9, 11, 0.22)',
              },
            ]}
          >
            {/* Step 1: En Cola */}
            <View
              style={[
                styles.stepPill,
                isQueued && {
                  backgroundColor: ticket.securityColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.stepPillText,
                  { color: isQueued ? '#09090B' : secondaryTextColor },
                ]}
              >
                1. En Cola
              </Text>
            </View>

            <Text style={[styles.stepArrow, { color: secondaryTextColor }]}>›</Text>

            {/* Step 2: Preparando */}
            <View
              style={[
                styles.stepPill,
                isPrep && {
                  backgroundColor: ticket.securityColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.stepPillText,
                  { color: isPrep ? '#09090B' : secondaryTextColor },
                ]}
              >
                2. Preparando
              </Text>
            </View>

            <Text style={[styles.stepArrow, { color: secondaryTextColor }]}>›</Text>

            {/* Step 3: ¡Listo en Barra! */}
            <View
              style={[
                styles.stepPill,
                isReady && {
                  backgroundColor: '#09090B',
                },
              ]}
            >
              <Text
                style={[
                  styles.stepPillText,
                  { color: isReady ? '#FAFAFA' : secondaryTextColor },
                ]}
              >
                3. ¡Listo en Barra!
              </Text>
            </View>
          </View>
        </View>

        {/* FULL-SCREEN LUMINOUS BILLBOARD: GIANT #A47 CODE */}
        <View
          style={[
            styles.luminousBillboard,
            {
              backgroundColor: isReady ? 'rgba(9, 9, 11, 0.92)' : '#121216',
              borderColor: isReady ? '#09090B' : ticket.securityColor,
            },
          ]}
        >
          {/* Moving Anti-Screenshot Kinetic Bar */}
          <Animated.View
            style={[
              styles.kineticWatermark,
              {
                backgroundColor: ticket.securityColor,
                transform: [
                  {
                    translateX: scannerWaveAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-110, 110],
                    }),
                  },
                ],
              },
            ]}
          />

          <View style={styles.securityColorPill}>
            <View
              style={[
                styles.securityColorSwatch,
                { backgroundColor: ticket.securityColor },
              ]}
            />
            <Text style={styles.securityLabel}>
              CARTEL LUMINOSO DE RETIRO · VENTANILLA EXPRESS
            </Text>
          </View>

          <Text
            style={[
              styles.giantCode,
              { color: isReady ? ticket.securityColor : '#FAFAFA' },
            ]}
          >
            #{ticket.shortCode}
          </Text>

          <Text style={styles.billboardInstruction}>
            {isReady
              ? '¡TU PEDIDO ESTÁ LISTO! MOSTRÁ ESTA PANTALLA AL BARTENDER'
              : 'Mantené esta pantalla abierta al acercarte a la barra'}
          </Text>
        </View>

        {/* QR WITH 60FPS LASER SCANLINE + DRINKS LIST */}
        <View style={styles.bottomPassCard}>
          <View style={styles.qrAndItemsRow}>
            {/* Real Offline JWT QR with 60FPS Laser Line */}
            <View style={styles.qrBox}>
              <QRCodeSVG
                value={
                  ticket.offlineQrToken ||
                  `TUTRAGO:${ticket.ticketId}:${ticket.shortCode}`
                }
                size={134}
                bgColor="#FFFFFF"
                fgColor="#09090B"
                level="M"
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.qrLaserLine,
                  {
                    backgroundColor: ticket.securityColor,
                    transform: [
                      {
                        translateY: pulseAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-66, 66],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Text style={styles.qrCaption}>PASE OFFLINE VERIFICADO</Text>
            </View>

            {/* Drinks included in this pickup */}
            <View style={styles.itemsBox}>
              <Text style={styles.itemsHeader}>DETALLE DE TU RETIRO</Text>
              {ticket.items.map((item, idx) => (
                <View key={idx} style={styles.itemRow}>
                  <View
                    style={[
                      styles.itemQtyBadge,
                      { borderColor: ticket.securityColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.itemQtyText,
                        { color: ticket.securityColor },
                      ]}
                    >
                      {item.quantity}x
                    </Text>
                  </View>
                  <Text style={styles.itemText} numberOfLines={2}>
                    {item.name}
                  </Text>
                </View>
              ))}

              <View style={styles.offlineShieldRow}>
                <View
                  style={[
                    styles.shieldDot,
                    { backgroundColor: ticket.securityColor },
                  ]}
                />
                <Text style={styles.offlineShieldText}>
                  {isOfflineMode
                    ? 'Modo sin señal activo · QR válido'
                    : 'Sincronizado en vivo con barra'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Discreet Pilot / KDS Simulator Bottom Sheet */}
      <Modal visible={pilotDrawerVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.pilotSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.pilotHeaderRow}>
              <View>
                <Text style={styles.pilotTag}>🛠️ MODO PILOTO · VENTANILLA</Text>
                <Text style={styles.pilotTitle}>Simulador de Turno KDS</Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setPilotDrawerVisible(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.pilotSub}>
              Simulá los cambios de estado desde la pantalla del bartender (KDS) y verificá la vibración háptica y el cambio de color:
            </Text>

            <View style={styles.kdsSimButtonsGrid}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.kdsSimBtn,
                  isQueued && styles.kdsSimBtnActive,
                ]}
                onPress={() => handleTransitionStatus('PREP_REQUESTED')}
              >
                <Text style={styles.kdsSimBtnText}>1. Pasar a En Cola</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.kdsSimBtn,
                  isPrep && styles.kdsSimBtnActive,
                ]}
                onPress={() => handleTransitionStatus('IN_PREPARATION')}
              >
                <Text style={styles.kdsSimBtnText}>2. Pasar a Preparando</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.kdsSimBtn,
                  isReady && styles.kdsSimBtnReady,
                ]}
                onPress={() => handleTransitionStatus('READY_FOR_PICKUP')}
              >
                <Text
                  style={[
                    styles.kdsSimBtnText,
                    isReady && { color: '#09090B' },
                  ]}
                >
                  3. ¡Listo en Barra! (Disparar Haptics)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.kdsSimBtn}
                onPress={handleCycleSecurityColor}
              >
                <Text style={styles.kdsSimBtnText}>
                  🎨 Rotar Color de Seguridad ({ticket.securityColor})
                </Text>
              </TouchableOpacity>
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
  },
  antiFraudTrack: {
    paddingTop: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  antiFraudPulseBar: {
    width: '100%',
    maxWidth: 488,
    height: 6,
    borderRadius: 3,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 34,
    gap: 16,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  backPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  backPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  clockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveClock: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  pilotCornerChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pilotCornerText: {
    fontSize: 10,
    fontWeight: '700',
  },
  barAndStepperBox: {
    alignItems: 'center',
    gap: 10,
  },
  barNameTitle: {
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  stepperTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: '#121216',
    borderRadius: 16,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stepPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPillText: {
    fontSize: 11,
    fontWeight: '900',
  },
  stepArrow: {
    fontSize: 14,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  luminousBillboard: {
    borderRadius: 32,
    borderWidth: 3,
    paddingVertical: 28,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
  },
  kineticWatermark: {
    width: 150,
    height: 6,
    borderRadius: 3,
    marginBottom: 14,
  },
  securityColorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  securityColorSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  securityLabel: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  giantCode: {
    fontSize: 108,
    fontWeight: '900',
    letterSpacing: -4,
    lineHeight: 118,
    marginVertical: 6,
  },
  billboardInstruction: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.3,
    paddingHorizontal: 10,
  },
  bottomPassCard: {
    width: '100%',
    backgroundColor: '#121216',
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  qrAndItemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  qrLaserLine: {
    position: 'absolute',
    width: '94%',
    height: 3.5,
    borderRadius: 2,
    opacity: 0.85,
  },
  qrCaption: {
    color: '#09090B',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 6,
  },
  itemsBox: {
    flex: 1,
    gap: 8,
  },
  itemsHeader: {
    color: '#A1A1AA',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemQtyBadge: {
    backgroundColor: '#09090B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  itemQtyText: {
    fontSize: 12,
    fontWeight: '900',
  },
  itemText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
  offlineShieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  shieldDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  offlineShieldText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '700',
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
  pilotTag: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  pilotTitle: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '900',
  },
  pilotSub: {
    color: '#A1A1AA',
    fontSize: 12,
    lineHeight: 18,
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
  kdsSimButtonsGrid: {
    gap: 10,
  },
  kdsSimBtn: {
    height: 48,
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  kdsSimBtnActive: {
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
  },
  kdsSimBtnReady: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  kdsSimBtnText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '900',
  },
});
