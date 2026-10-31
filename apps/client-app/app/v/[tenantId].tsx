import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useWalletStore } from '../../src/store/walletStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tutrago-api.onrender.com';

export default function QrVenueEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tenantId: string; bar?: string }>();
  const rawTenantId = params.tenantId || 'club-tutrago';
  const rawBarParam = params.bar || '00000000-0000-4000-8000-000000000101';

  const {
    user,
    venue,
    bars,
    drinks,
    activeTicket,
    setVenueContext,
    loginWithOAuth,
    loginWithOtp,
    loginAsGuest,
  } = useWalletStore();

  const [authLoading, setAuthLoading] = useState<string | null>(null);
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [contactInput, setContactInput] = useState('+54 9 11 5584-9201');
  const [otpStep, setOtpStep] = useState<'INPUT' | 'VERIFY'>('INPUT');
  const [otpCode, setOtpCode] = useState('4829');

  // Resolver barra desde query param (?bar=...)
  const resolvedBar =
    bars.find(
      (b) =>
        b.id === rawBarParam ||
        b.name.toLowerCase().includes(rawBarParam.toLowerCase().replace(/-/g, ' '))
    ) || bars[0];

  useEffect(() => {
    // Persistir contexto del QR en localStorage inmediatamente al escanear
    setVenueContext({
      tenantSlug: rawTenantId,
      selectedBarId: resolvedBar.id,
    });

    // Intentar enriquecer datos del Tenant desde la API sin bloquear la UI
    const fetchTenantMetadata = async () => {
      try {
        const endpoint = rawTenantId.startsWith('0000')
          ? `${API_URL}/tenants/${rawTenantId}/bars`
          : `${API_URL}/tenants/slug/${rawTenantId}`;
        const res = await fetch(endpoint);
        if (res.ok) {
          const data = await res.json();
          if (data?.id && data?.name) {
            setVenueContext({
              tenantId: data.id,
              tenantSlug: data.slug || rawTenantId,
              tenantName: data.name,
            });
          }
        }
      } catch {
        // Modo offline-first resiliente: mantiene configuración local
      }
    };

    fetchTenantMetadata();
  }, [rawTenantId, resolvedBar.id]);

  const navigateToCatalog = () => {
    router.replace({
      pathname: '/(club)/[tenantId]',
      params: { tenantId: rawTenantId, bar: resolvedBar.id },
    });
  };

  const handleOAuthOneTouch = (provider: 'GOOGLE' | 'APPLE') => {
    setAuthLoading(provider);
    setTimeout(() => {
      loginWithOAuth(provider);
      setAuthLoading(null);
      navigateToCatalog();
    }, 220);
  };

  const handleGuestFastTrack = () => {
    setAuthLoading('GUEST');
    setTimeout(() => {
      loginAsGuest();
      setAuthLoading(null);
      navigateToCatalog();
    }, 150);
  };

  const handleSendOtp = () => {
    if (!contactInput.trim()) return;
    setOtpStep('VERIFY');
  };

  const handleVerifyOtp = () => {
    setAuthLoading('OTP');
    setTimeout(() => {
      loginWithOtp(contactInput.trim());
      setAuthLoading(null);
      navigateToCatalog();
    }, 200);
  };

  const totalDrinksInWallet = drinks.reduce((acc, d) => acc + d.quantityRemaining, 0);

  return (
    <View style={styles.container}>
      {/* Nightclub OLED Ambient Glows */}
      <View pointerEvents="none" style={styles.ambientVioletGlow} />
      <View pointerEvents="none" style={styles.ambientAmberGlow} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Navigation Row */}
        <View style={styles.topNav}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.backPill}
            onPress={() => router.push('/')}
          >
            <Text style={styles.backPillText}>← Inicio</Text>
          </TouchableOpacity>

          {totalDrinksInWallet > 0 && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.walletTopPill}
              onPress={() => router.push('/wallet')}
            >
              <Text style={styles.walletTopPillIcon}>🎟️</Text>
              <Text style={styles.walletTopPillText}>Mis Vales</Text>
              <View style={styles.walletTopCount}>
                <Text style={styles.walletTopCountText}>{totalDrinksInWallet}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Active Ticket Banner if present */}
        {activeTicket && activeTicket.status !== 'DELIVERED' && (
          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.emergencyTicketBanner,
              { borderColor: activeTicket.securityColor || '#10B981' },
            ]}
            onPress={() => router.push(`/ticket/${activeTicket.ticketId}`)}
          >
            <View
              style={[
                styles.pulseDot,
                { backgroundColor: activeTicket.securityColor || '#10B981' },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.emergencyTitle}>
                TURNO ACTIVO #{activeTicket.shortCode} · {activeTicket.barName}
              </Text>
              <Text style={styles.emergencySub}>
                Tocá para abrir tu código luminoso de retiro
              </Text>
            </View>
            <Text style={styles.emergencyArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* Immersive Nightclub Hero & Detected QR Bar Badge */}
        <View style={styles.heroBlock}>
          <View style={styles.qrVerifiedChip}>
            <View style={styles.qrVerifiedDot} />
            <Text style={styles.qrVerifiedText}>ACCESO QR DETECTADO</Text>
          </View>

          <Text style={styles.clubName}>{venue.tenantName}</Text>
          <Text style={styles.clubTagline}>
            Pedí desde donde estás y retirá por ventanilla exclusiva sin hacer fila.
          </Text>

          {/* Detected Bar Spotlight Card */}
          <View style={styles.barDetectedCard}>
            <View style={styles.barDetectedIconWrap}>
              <Text style={styles.barDetectedEmoji}>🍸</Text>
            </View>
            <View style={styles.barDetectedCenter}>
              <View style={styles.barDetectedTagRow}>
                <Text style={styles.barDetectedLabel}>BARRA ASIGNADA</Text>
                <View style={styles.barSectorChip}>
                  <Text style={styles.barSectorChipText}>{resolvedBar.tag}</Text>
                </View>
              </View>
              <Text style={styles.barDetectedName}>{resolvedBar.name}</Text>
              <Text style={styles.barDetectedMeta}>Retiro rápido habilitado</Text>
            </View>
            <View style={styles.waitPill}>
              <Text style={styles.waitPillLabel}>DEMORA</Text>
              <Text style={styles.waitPillValue}>{resolvedBar.wait}</Text>
            </View>
          </View>
        </View>

        {/* Primary Action Card: 1-Touch Luminous "Entrar a la Barra" */}
        <View style={styles.mainActionCard}>
          <TouchableOpacity
            activeOpacity={0.88}
            disabled={authLoading !== null}
            style={styles.enterBarPrimaryBtn}
            onPress={handleGuestFastTrack}
          >
            {authLoading === 'GUEST' ? (
              <ActivityIndicator color="#FAFAFA" />
            ) : (
              <View style={styles.enterBarBtnInner}>
                <View>
                  <Text style={styles.enterBarSubLabel}>ACCESO INSTANTÁNEO · 1 TOQUE</Text>
                  <Text style={styles.enterBarTitle}>Entrar a la Barra</Text>
                </View>
                <View style={styles.enterBarCircle}>
                  <Text style={styles.enterBarArrow}>→</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>

          {user && (
            <View style={styles.sessionActiveRow}>
              <View style={styles.sessionDot} />
              <Text style={styles.sessionActiveText}>
                Conectado como <Text style={styles.sessionUserBold}>{user.fullName}</Text>
              </Text>
            </View>
          )}
        </View>

        {/* Clean Secondary Access Options */}
        <View style={styles.secondaryAuthBlock}>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>O VINCULÁ TU CUENTA</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.oauthRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={authLoading !== null}
              style={styles.oauthBtn}
              onPress={() => handleOAuthOneTouch('APPLE')}
            >
              {authLoading === 'APPLE' ? (
                <ActivityIndicator color="#FAFAFA" />
              ) : (
                <>
                  <Text style={styles.oauthIcon}></Text>
                  <Text style={styles.oauthBtnText}>Continuar con Apple</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={authLoading !== null}
              style={styles.oauthBtn}
              onPress={() => handleOAuthOneTouch('GOOGLE')}
            >
              {authLoading === 'GOOGLE' ? (
                <ActivityIndicator color="#FAFAFA" />
              ) : (
                <>
                  <Text style={styles.oauthIcon}>G</Text>
                  <Text style={styles.oauthBtnText}>Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Clean WhatsApp / Phone OTP Option */}
          {!showOtpForm ? (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.otpToggleBtn}
              onPress={() => setShowOtpForm(true)}
            >
              <Text style={styles.otpToggleText}>
                📱 Resguardar mis vales con WhatsApp
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.otpCard}>
              <View style={styles.otpCardHeader}>
                <Text style={styles.otpTitle}>
                  {otpStep === 'INPUT'
                    ? 'Ingresá tu WhatsApp para vincular tus vales'
                    : 'Ingresá el código de 4 dígitos'}
                </Text>
                <TouchableOpacity onPress={() => setShowOtpForm(false)}>
                  <Text style={styles.otpClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {otpStep === 'INPUT' ? (
                <View style={styles.otpInputGroup}>
                  <TextInput
                    value={contactInput}
                    onChangeText={setContactInput}
                    placeholder="+54 9 11 ..."
                    placeholderTextColor="#52525B"
                    style={styles.otpInput}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.otpActionBtn}
                    onPress={handleSendOtp}
                  >
                    <Text style={styles.otpActionText}>Recibir Código</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.otpInputGroup}>
                  <TextInput
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder="4829"
                    placeholderTextColor="#52525B"
                    keyboardType="number-pad"
                    maxLength={4}
                    style={[styles.otpInput, styles.otpCodeInput]}
                  />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.otpActionBtn}
                    onPress={handleVerifyOtp}
                  >
                    {authLoading === 'OTP' ? (
                      <ActivityIndicator color="#FAFAFA" />
                    ) : (
                      <Text style={styles.otpActionText}>Confirmar y Entrar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Subtle Trust Footer */}
        <View style={styles.trustFooter}>
          <Text style={styles.trustFooterText}>
            🔒 Tus tragos pagados quedan guardados en tu teléfono y funcionan aún sin señal dentro del club.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  ambientVioletGlow: {
    position: 'absolute',
    top: -90,
    left: -40,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(75px)' } as any) : {}),
  },
  ambientAmberGlow: {
    position: 'absolute',
    bottom: 60,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '700',
  },
  walletTopPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 5,
    borderRadius: 999,
  },
  walletTopPillIcon: {
    fontSize: 13,
  },
  walletTopPillText: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '800',
  },
  walletTopCount: {
    backgroundColor: '#F59E0B',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  walletTopCountText: {
    color: '#09090B',
    fontSize: 11,
    fontWeight: '900',
  },
  emergencyTicketBanner: {
    backgroundColor: '#121216',
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  emergencyTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  emergencySub: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 2,
  },
  emergencyArrow: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '900',
  },
  heroBlock: {
    gap: 12,
    marginTop: 4,
  },
  qrVerifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  qrVerifiedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
  },
  qrVerifiedText: {
    color: '#C4B5FD',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  clubName: {
    color: '#FAFAFA',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  clubTagline: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  barDetectedCard: {
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  barDetectedIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barDetectedEmoji: {
    fontSize: 24,
  },
  barDetectedCenter: {
    flex: 1,
    gap: 2,
  },
  barDetectedTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barDetectedLabel: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  barSectorChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  barSectorChipText: {
    color: '#D4D4D8',
    fontSize: 10,
    fontWeight: '700',
  },
  barDetectedName: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '900',
  },
  barDetectedMeta: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  waitPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  waitPillLabel: {
    color: '#A1A1AA',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  waitPillValue: {
    color: '#10B981',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  mainActionCard: {
    gap: 12,
  },
  enterBarPrimaryBtn: {
    minHeight: 74,
    backgroundColor: '#8B5CF6',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 16,
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  enterBarBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enterBarSubLabel: {
    color: 'rgba(250, 250, 250, 0.78)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  enterBarTitle: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  enterBarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(9, 9, 11, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterBarArrow: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '900',
  },
  sessionActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sessionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  sessionActiveText: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  sessionUserBold: {
    color: '#D4D4D8',
    fontWeight: '800',
  },
  secondaryAuthBlock: {
    gap: 12,
    marginTop: 4,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  oauthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  oauthBtn: {
    flex: 1,
    height: 52,
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  oauthIcon: {
    color: '#FAFAFA',
    fontSize: 17,
    fontWeight: '900',
  },
  oauthBtnText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '800',
  },
  otpToggleBtn: {
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpToggleText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '700',
  },
  otpCard: {
    backgroundColor: '#121216',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  otpCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  otpTitle: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  otpClose: {
    color: '#71717A',
    fontSize: 15,
    fontWeight: '800',
    paddingLeft: 8,
  },
  otpInputGroup: {
    gap: 10,
  },
  otpInput: {
    height: 50,
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '700',
  },
  otpCodeInput: {
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  otpActionBtn: {
    height: 50,
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpActionText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '900',
  },
  trustFooter: {
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  trustFooterText: {
    color: '#52525B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
