import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore } from '../../src/store/walletStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://tutrago-api.onrender.com';

export default function WalletScreen() {
  const router = useRouter();
  const { drinks, setActiveTicket, redeemDrinkLocally } = useWalletStore();

  const [selectedBar, setSelectedBar] = useState('00000000-0000-4000-8000-000000000101');
  const [redeemQuantities, setRedeemQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const bars = [
    { id: '00000000-0000-4000-8000-000000000101', name: 'Barra Pista Central', wait: '~3 min', tag: 'Más cercana' },
    { id: '00000000-0000-4000-8000-000000000102', name: 'Barra Terraza VIP', wait: '~1 min', tag: 'Rápida' },
    { id: '00000000-0000-4000-8000-000000000103', name: 'Barra Patio Electrónica', wait: '~2 min', tag: 'Patio' },
  ];

  const updateQuantity = (itemId: string, max: number, delta: number) => {
    const current = redeemQuantities[itemId] || 0;
    const next = Math.max(0, Math.min(max, current + delta));
    setRedeemQuantities((prev) => ({ ...prev, [itemId]: next }));
  };

  const totalSelectedToRedeem = Object.values(redeemQuantities).reduce((a, b) => a + b, 0);

  // Botón "ESTOY EN LA BARRA - PREPARAR AHORA"
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

    const selectedBarObj = bars.find((b) => b.id === selectedBar);

    let newTicket: any = null;

    try {
      const response = await fetch(`${API_URL}/pickup/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000901',
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
      // Contingencia offline-first local
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

    // Descontar del inventario de la wallet
    for (const item of itemsToRedeem) {
      redeemDrinkLocally(item.orderItemId, item.quantityToRedeem);
    }

    // Persistir ticket offline
    setActiveTicket(newTicket);
    setLoading(false);

    // Navegar de inmediato a la Pantalla de Retiro Anti-Ruido
    router.push(`/ticket/${newTicket.ticketId}`);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Encabezado */}
        <View style={styles.headerBox}>
          <Text style={styles.badge}>BILLETERA DE TRAGOS</Text>
          <Text style={styles.title}>Mis Tragos en Espera</Text>
          <Text style={styles.subtitle}>
            Tus bebidas ya están pagadas. Elige qué retirar ahora y en qué barra.
          </Text>
        </View>

        {/* 1. Selección de Barra */}
        <Text style={styles.sectionTitle}>1. Elige a qué barra te estás acercando:</Text>
        <View style={styles.barList}>
          {bars.map((bar) => {
            const isSelected = selectedBar === bar.id;
            return (
              <TouchableOpacity
                key={bar.id}
                activeOpacity={0.8}
                onPress={() => setSelectedBar(bar.id)}
                style={[styles.barCard, isSelected && styles.barCardSelected]}
              >
                <View style={styles.barCardLeft}>
                  <Text style={[styles.barName, isSelected && { color: '#3B82F6' }]}>
                    {bar.name}
                  </Text>
                  <Text style={styles.barTag}>{bar.tag}</Text>
                </View>
                <View style={styles.waitBadge}>
                  <Text style={styles.waitText}>{bar.wait}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 2. Selección de Bebidas a Canjear */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
          2. Selecciona qué tragos quieres preparar ahora:
        </Text>

        {drinks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No tienes bebidas en espera en este momento.</Text>
            <TouchableOpacity
              style={styles.browseBtn}
              onPress={() => router.push('/(club)/club-tutrago/')}
            >
              <Text style={styles.browseBtnText}>Ver Carta del Boliche</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.drinkList}>
            {drinks.map((item) => {
              const qtyToRedeem = redeemQuantities[item.orderItemId] || 0;
              return (
                <View key={item.orderItemId} style={styles.drinkCard}>
                  <View style={styles.drinkInfo}>
                    <Text style={styles.drinkName}>{item.productName}</Text>
                    <Text style={styles.availableQty}>
                      Tienes {item.quantityRemaining} disponibles
                    </Text>
                  </View>

                  <View style={styles.counterControl}>
                    <TouchableOpacity
                      style={styles.counterBtn}
                      onPress={() => updateQuantity(item.orderItemId, item.quantityRemaining, -1)}
                    >
                      <Text style={styles.counterBtnText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.counterValue}>{qtyToRedeem}</Text>
                    <TouchableOpacity
                      style={styles.counterBtn}
                      onPress={() => updateQuantity(item.orderItemId, item.quantityRemaining, 1)}
                    >
                      <Text style={styles.counterBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Botón de Despacho Táctil Gigante */}
      {totalSelectedToRedeem > 0 && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            disabled={loading}
            activeOpacity={0.85}
            style={styles.activateBtn}
            onPress={handleActivatePickup}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.activateBtnText}>
                ESTOY EN LA BARRA - PREPARAR AHORA ({totalSelectedToRedeem})
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },
  headerBox: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 20,
  },
  badge: {
    color: '#10B981',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  title: {
    color: '#FAFAFA',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  subtitle: {
    color: '#A1A1AA',
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },
  sectionTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  barList: {
    gap: 10,
  },
  barCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#121215',
    borderWidth: 1.5,
    borderColor: '#27272A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  barCardSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#18181B',
  },
  barCardLeft: {
    flex: 1,
  },
  barName: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
  barTag: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  waitBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#27272A',
  },
  waitText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  drinkList: {
    gap: 12,
  },
  drinkCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drinkInfo: {
    flex: 1,
  },
  drinkName: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
  availableQty: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 3,
  },
  counterControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  counterBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: 'bold',
  },
  counterValue: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 8,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    backgroundColor: '#121215',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  emptyText: {
    color: '#71717A',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  browseBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
  },
  browseBtnText: {
    color: '#FAFAFA',
    fontSize: 14,
    fontWeight: '800',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#18181B',
    borderTopWidth: 1,
    borderColor: '#27272A',
  },
  activateBtn: {
    height: 58, // Altura ergonómica táctil superior a 56px
    borderRadius: 16,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  activateBtnText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
