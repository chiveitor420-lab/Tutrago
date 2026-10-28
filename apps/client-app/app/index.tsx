import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function IndexScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logoBadge}>TUTRAGO</Text>
        <Text style={styles.title}>Club Nocturno Tutrago</Text>
        <Text style={styles.subtitle}>Pide tus bebidas sin hacer filas en la barra</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.primaryBtn, { backgroundColor: '#3B82F6' }]}
          onPress={() => router.push('/(club)/club-tutrago/')}
        >
          <Text style={styles.btnText}>Ver Carta y Comprar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.primaryBtn, { backgroundColor: '#18181B', borderWidth: 1, borderColor: '#27272A' }]}
          onPress={() => router.push('/wallet')}
        >
          <Text style={[styles.btnText, { color: '#10B981' }]}>Mis Tragos en Espera (Wallet)</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footerNote}>
        🔒 Pagos protegidos con Mercado Pago Split Payment. Retiros parciales en cualquier barra durante la noche.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    padding: 24,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: 60,
  },
  logoBadge: {
    color: '#3B82F6',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    color: '#FAFAFA',
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 16,
    marginTop: 8,
  },
  actions: {
    gap: 16,
  },
  primaryBtn: {
    height: 56, // Ergonomía mínima obligatoria: 56px
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  footerNote: {
    color: '#71717A',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
});
