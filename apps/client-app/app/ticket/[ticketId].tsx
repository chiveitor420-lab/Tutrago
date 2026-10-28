import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useWalletStore } from '../../../src/store/walletStore';
import * as Haptics from 'expo-haptics';

export default function AntiNoiseTicketScreen() {
  const router = useRouter();
  const { ticketId } = useLocalSearchParams();
  const { activeTicket, setActiveTicket } = useWalletStore();

  const [ticket, setTicket] = useState(
    activeTicket || {
      ticketId: String(ticketId),
      shortCode: 'A47',
      securityColor: '#10B981', // Verde de seguridad
      status: 'READY_FOR_PICKUP' as const,
      barName: 'Barra Pista Central',
      items: [{ name: 'Fernet Branca con Coca-Cola', quantity: 2 }],
      offlineQrToken: 'OFFLINE_JWT_TOKEN_VERIFIED',
      activatedAt: new Date().toISOString(),
    }
  );

  // Reloj antifraude dinámico con milisegundos
  const [timeString, setTimeString] = useState('');
  // Barra de pulso animada a 60 FPS
  const pulseAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    // 1. Loop de animación fluida de pulso antifraude
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 2. Reloj en vivo de milisegundos para invalidar capturas de pantalla estáticas
    const timer = setInterval(() => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const ms = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0');
      setTimeString(`${h}:${m}:${s}.${ms}`);
    }, 50);

    // 3. Vibración fuerte cuando pasa a READY_FOR_PICKUP
    if (ticket.status === 'READY_FOR_PICKUP') {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        // En navegadores web donde Haptics no está soportado
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([200, 100, 200]);
        }
      }
    }

    return () => clearInterval(timer);
  }, [ticket.status]);

  const isReady = ticket.status === 'READY_FOR_PICKUP';
  const backgroundColor = isReady ? ticket.securityColor : '#121215';
  const textColor = isReady ? '#09090B' : '#FAFAFA';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {/* Barra Antifraude Superior de Pulso Animado a 60 FPS */}
      <Animated.View
        style={[
          styles.antiFraudBar,
          {
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            }),
            transform: [
              {
                scaleX: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.85, 1],
                }),
              },
            ],
          },
        ]}
      />

      {/* Reloj y Estado */}
      <View style={styles.topInfo}>
        <View style={styles.badgeRow}>
          <Text style={[styles.statusBadge, { color: textColor }]}>
            {isReady ? '¡TU PEDIDO ESTÁ LISTO!' : 'PREPARANDO EN BARRA...'}
          </Text>
          <Text style={[styles.liveClock, { color: textColor }]}>{timeString}</Text>
        </View>
        <Text style={[styles.barName, { color: textColor }]}>
          Retira en: {ticket.barName}
        </Text>
      </View>

      {/* CÓDIGO GIGANTE (40% de la pantalla para entorno oscuro y ruidoso) */}
      <View style={styles.codeContainer}>
        <Text style={[styles.giantCode, { color: textColor }]}>
          #{ticket.shortCode}
        </Text>
        <Text style={[styles.codeSubtitle, { color: textColor }]}>
          Muestra esta pantalla al bartender
        </Text>
      </View>

      {/* Detalle de bebidas y QR Offline */}
      <View style={styles.ticketDetails}>
        <View style={styles.itemsBox}>
          {ticket.items.map((item, idx) => (
            <Text key={idx} style={[styles.itemText, { color: textColor }]}>
              • {item.quantity}x {item.name}
            </Text>
          ))}
        </View>

        {/* Simulación del QR Offline */}
        <View style={styles.qrContainer}>
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrText}>QR OFFLINE VALIDADO</Text>
            <Text style={styles.qrSub}>Firma Criptográfica JWT</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => router.push('/wallet')}
        >
          <Text style={styles.closeBtnText}>Volver a Mis Tragos</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  antiFraudBar: {
    position: 'absolute',
    top: 10,
    left: 20,
    right: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  topInfo: {
    marginTop: 30,
    alignItems: 'center',
    width: '100%',
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 8,
  },
  statusBadge: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  liveClock: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  barName: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },
  codeContainer: {
    height: height * 0.4, // 40% del alto de la pantalla
    justifyContent: 'center',
    alignItems: 'center',
  },
  giantCode: {
    fontSize: 105,
    fontWeight: '900',
    letterSpacing: -2,
  },
  codeSubtitle: {
    fontSize: 16,
    fontWeight: '700',
    opacity: 0.85,
    marginTop: 4,
  },
  ticketDetails: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  itemsBox: {
    marginBottom: 16,
    alignItems: 'center',
  },
  itemText: {
    fontSize: 16,
    fontWeight: '800',
    marginVertical: 2,
  },
  qrContainer: {
    marginBottom: 20,
  },
  qrPlaceholder: {
    width: 140,
    height: 140,
    backgroundColor: '#000000',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  qrText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
  },
  qrSub: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 9,
    marginTop: 6,
  },
  closeBtn: {
    height: 56, // Altura mínima de botón
    width: '100%',
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
