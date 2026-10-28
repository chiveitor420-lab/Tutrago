import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore } from '../../../src/store/walletStore';

interface ProductItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  upsell?: {
    title: string;
    additionalPrice: number;
  };
}

export default function ClubMenuScreen() {
  const router = useRouter();
  const { drinks, setDrinks } = useWalletStore();

  const [products] = useState<ProductItem[]>([
    {
      id: 'p-fernet',
      name: 'Fernet Branca con Coca-Cola',
      category: 'Tragos Clásicos',
      price: 9500,
      description: 'El clásico con hielo roca y vaso largo.',
      upsell: { title: 'Medida Doble de Fernet', additionalPrice: 4000 },
    },
    {
      id: 'p-gin',
      name: 'Gin Tonic Nacional',
      category: 'Gin & Cocktails',
      price: 8500,
      description: 'Bayas de enebro y tónica Schweppes fría.',
      upsell: { title: 'Upgrade a Gin Bombay Sapphire', additionalPrice: 4500 },
    },
    {
      id: 'p-vodka',
      name: 'Vodka Smirnoff con Red Bull',
      category: 'Tragos con Energizante',
      price: 11000,
      description: 'Vodka triple destilación con lata helada.',
      upsell: { title: 'Upgrade a Vodka Absolut', additionalPrice: 4000 },
    },
    {
      id: 'p-corona',
      name: 'Cerveza Corona 330ml',
      category: 'Cervezas',
      price: 5500,
      description: 'Porrón frío servido con gajo de lima.',
    },
    {
      id: 'p-combo-vip',
      name: 'Combo VIP: Chandon + 4 Speed',
      category: 'Combos VIP',
      price: 36000,
      description: 'Frapera con hielo y 4 latas de energizante.',
      upsell: { title: 'Upgrade a Chandon Délice', additionalPrice: 5000 },
    },
  ]);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [upsellModalVisible, setUpsellModalVisible] = useState(false);
  const [activeUpsell, setActiveUpsell] = useState<{ productId: string; title: string; price: number } | null>(null);

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalPrice = Object.entries(cart).reduce((sum, [pId, qty]) => {
    const prod = products.find((p) => p.id === pId);
    return sum + (prod ? prod.price * qty : 0);
  }, 0);

  const addItem = (id: string) => {
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

  // Botón "Ir a Pagar": Detecta si hay upsells disponibles antes de redirigir
  const handleProceedToPayment = () => {
    // Buscar si algún producto del carrito tiene upsell
    for (const [pId, qty] of Object.entries(cart)) {
      if (qty > 0) {
        const prod = products.find((p) => p.id === pId);
        if (prod?.upsell) {
          setActiveUpsell({
            productId: prod.id,
            title: prod.upsell.title,
            price: prod.upsell.additionalPrice,
          });
          setUpsellModalVisible(true);
          return;
        }
      }
    }
    finalizeCheckout();
  };

  const finalizeCheckout = () => {
    setUpsellModalVisible(false);

    // Agregar las bebidas compradas directamente a la Wallet del store en estado PAID_ON_HOLD
    const newWalletItems = Object.entries(cart).map(([pId, qty]) => {
      const prod = products.find((p) => p.id === pId)!;
      return {
        orderItemId: `item-${Date.now()}-${pId}`,
        orderId: `order-${Date.now()}`,
        productId: prod.id,
        productName: prod.name,
        category: prod.category,
        unitPrice: prod.price,
        quantityRemaining: qty,
      };
    });

    setDrinks([...drinks, ...newWalletItems]);
    setCart({});

    // Redirigir a la Wallet de bebidas
    router.push('/wallet');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Barra Abierta en Todo el Boliche</Text>
          <Text style={styles.bannerSub}>Compra ahora y retira en cualquier barra cuando quieras</Text>
        </View>

        <View style={styles.productList}>
          {products.map((product) => {
            const count = cart[product.id] || 0;
            return (
              <View key={product.id} style={styles.productCard}>
                <View style={styles.productInfo}>
                  <Text style={styles.categoryBadge}>{product.category}</Text>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productDesc}>{product.description}</Text>
                  <Text style={styles.priceTag}>${product.price.toLocaleString('es-AR')}</Text>
                </View>

                <View style={styles.counterRow}>
                  {count > 0 ? (
                    <View style={styles.counterControl}>
                      <TouchableOpacity
                        style={styles.counterBtn}
                        onPress={() => removeItem(product.id)}
                      >
                        <Text style={styles.counterBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.counterCount}>{count}</Text>
                      <TouchableOpacity
                        style={styles.counterBtn}
                        onPress={() => addItem(product.id)}
                      >
                        <Text style={styles.counterBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => addItem(product.id)}
                    >
                      <Text style={styles.addBtnText}>+ Agregar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Barra flotante de Checkout */}
      {totalItems > 0 && (
        <View style={styles.checkoutBar}>
          <View>
            <Text style={styles.checkoutItems}>{totalItems} bebidas seleccionadas</Text>
            <Text style={styles.checkoutTotal}>${totalPrice.toLocaleString('es-AR')}</Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.payBtn}
            onPress={handleProceedToPayment}
          >
            <Text style={styles.payBtnText}>Ir a Pagar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal de Upselling en 1 Clic */}
      <Modal visible={upsellModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalBadge}>OFERTA EXCLUSIVA DE BARRA</Text>
            <Text style={styles.modalTitle}>¿Deseas mejorar tu trago?</Text>
            <Text style={styles.modalSub}>
              {activeUpsell?.title} por solo +${activeUpsell?.price.toLocaleString('es-AR')}
            </Text>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: '#3B82F6', marginBottom: 12 }]}
              onPress={() => finalizeCheckout()}
            >
              <Text style={styles.btnText}>¡Sí, agregar Upgrade!</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: '#27272A' }]}
              onPress={() => finalizeCheckout()}
            >
              <Text style={[styles.btnText, { color: '#A1A1AA' }]}>No, mantener versión clásica</Text>
            </TouchableOpacity>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  banner: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 20,
  },
  bannerTitle: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  bannerSub: {
    color: '#A1A1AA',
    fontSize: 13,
    marginTop: 4,
  },
  productList: {
    gap: 16,
  },
  productCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27272A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productInfo: {
    flex: 1,
    paddingRight: 12,
  },
  categoryBadge: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  productName: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  productDesc: {
    color: '#71717A',
    fontSize: 12,
    marginTop: 2,
  },
  priceTag: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 8,
  },
  counterRow: {
    alignItems: 'flex-end',
  },
  addBtn: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: '#3B82F6',
    fontWeight: '800',
    fontSize: 13,
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
  counterCount: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 8,
  },
  checkoutBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 84,
    backgroundColor: '#18181B',
    borderTopWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkoutItems: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  checkoutTotal: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '900',
  },
  payBtn: {
    height: 56, // Ergonomía mínima
    paddingHorizontal: 28,
    borderRadius: 16,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  payBtnText: {
    color: '#FAFAFA',
    fontSize: 16,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#18181B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderColor: '#27272A',
  },
  modalBadge: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  modalTitle: {
    color: '#FAFAFA',
    fontSize: 22,
    fontWeight: '900',
  },
  modalSub: {
    color: '#A1A1AA',
    fontSize: 15,
    marginTop: 6,
    marginBottom: 24,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: '800',
  },
});
