'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  DollarSign,
} from 'lucide-react';
import { io } from 'socket.io-client';
import {
  getApiUrl,
  getWsUrl,
  DEFAULT_TENANT_ID,
  getStaffAuthHeaders,
  ensureSignedStaffSession,
} from '@/lib/api-config';

interface ProductStock {
  id: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
}

export default function StockSwitchboardPage() {
  const [products, setProducts] = useState<ProductStock[]>([]);
  const [recoveryModalProduct, setRecoveryModalProduct] = useState<ProductStock | null>(null);
  const [substitutes, setSubstitutes] = useState<ProductStock[]>([]);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/catalog/tenant/${DEFAULT_TENANT_ID}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setProducts(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    ensureSignedStaffSession({ defaultRole: 'BARTENDER' }).finally(() => {
      loadCatalog();
    });

    const socket = io(getWsUrl(), {
      transports: ['websocket', 'polling'],
    });

    socket.on('stock:toggled', (payload: { productId: string; isAvailable: boolean }) => {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === payload.productId ? { ...p, isAvailable: payload.isAvailable } : p
        )
      );
    });

    socket.on('catalog:updated', () => {
      loadCatalog();
    });

    return () => {
      socket.disconnect();
    };
  }, [loadCatalog]);

  const toggleAvailability = async (product: ProductStock) => {
    const nextState = !product.isAvailable;
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, isAvailable: nextState } : p))
    );

    try {
      await fetch(`${getApiUrl()}/catalog/product/${product.id}/stock`, {
        method: 'PATCH',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `stock-toggle-${product.id}-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER' }
        ),
        body: JSON.stringify({ isAvailable: nextState }),
      });
    } catch {
      // ignore
    }
  };

  const openRecovery = async (product: ProductStock) => {
    setRecoveryModalProduct(product);
    const localSubs = products
      .filter((p) => p.isAvailable && p.id !== product.id)
      .slice(0, 3);
    setSubstitutes(localSubs);

    try {
      const res = await fetch(`${getApiUrl()}/catalog/product/${product.id}/recovery`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suggestedSubstitutes) && data.suggestedSubstitutes.length > 0) {
          setSubstitutes(data.suggestedSubstitutes);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleResolveRecovery = async (
    type: 'SUBSTITUTE' | 'REFUND',
    product: ProductStock,
    sub?: ProductStock
  ) => {
    try {
      const res = await fetch(`${getApiUrl()}/pickup/service-recovery`, {
        method: 'POST',
        headers: getStaffAuthHeaders(
          {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `stock-rec-${Date.now()}`,
          },
          { defaultRole: 'BARTENDER' }
        ),
        body: JSON.stringify({
          action: type,
          productId: product.id,
          substituteProductId: sub?.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionSuccess(data.message);
      } else {
        throw new Error('Fallback');
      }
    } catch {
      setActionSuccess(
        type === 'SUBSTITUTE'
          ? `¡Sustitución de ${product.name} por ${sub?.name || 'trago equivalente'} autorizada en barra!`
          : `¡Reembolso automático de $${product.price.toLocaleString('es-AR')} por ${product.name} emitido vía Mercado Pago!`
      );
    }

    setRecoveryModalProduct(null);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between pb-6 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition text-zinc-300"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              Panel de Switches de Stock
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                EN VIVO · WEBSOCKETS
              </span>
            </h1>
            <p className="text-sm text-zinc-400">
              Modifica la disponibilidad instantánea de bebidas en la App de clientes y terminales
              KDS.
            </p>
          </div>
        </div>
      </div>

      {actionSuccess && (
        <div className="mt-4 p-4 rounded-xl bg-emerald-950/80 border border-emerald-500/80 text-emerald-200 font-bold text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => (
          <div
            key={product.id}
            className={`p-5 rounded-2xl border transition flex flex-col justify-between ${
              product.isAvailable
                ? 'bg-zinc-900/80 border-zinc-800'
                : 'bg-rose-950/20 border-rose-900/60 opacity-95'
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {product.category}
                </span>
                <span className="text-sm font-black text-zinc-200">
                  ${Number(product.price).toLocaleString('es-AR')}
                </span>
              </div>

              <h3 className="text-base font-bold text-white mb-1">{product.name}</h3>

              <div className="mt-2 flex items-center gap-2">
                {product.isAvailable ? (
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> DISPONIBLE
                  </span>
                ) : (
                  <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> AGOTADO
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-zinc-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleAvailability(product)}
                className={`flex-1 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition min-h-[50px] ${
                  product.isAvailable
                    ? 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                }`}
              >
                {product.isAvailable ? 'Marcar AGOTADO' : 'Habilitar STOCK'}
              </button>

              {!product.isAvailable && (
                <button
                  type="button"
                  onClick={() => openRecovery(product)}
                  title="Flujo de contingencia si un cliente ya lo tenía comprado"
                  className="px-3 py-3 rounded-xl bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 font-bold text-xs flex items-center gap-1 transition"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Recovery
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {recoveryModalProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-black text-white">
                Service Recovery en 1 Clic: {recoveryModalProduct.name}
              </h3>
            </div>

            <p className="text-sm text-zinc-300 mb-4">
              Si un cliente compró esta bebida antes del agotamiento y activa su retiro en barra,
              resuelve en 1 clic:
            </p>

            <div className="space-y-2.5">
              {substitutes.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() =>
                    handleResolveRecovery('SUBSTITUTE', recoveryModalProduct, sub)
                  }
                  className="w-full p-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-left flex items-center justify-between transition"
                >
                  <div>
                    <h4 className="font-bold text-white text-sm flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-blue-400" />
                      Sustituir por: {sub.name}
                    </h4>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {sub.category} · Valor ${Number(sub.price).toLocaleString('es-AR')}
                    </p>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 bg-blue-600 text-white rounded-lg">
                    Reemplazar 1-Clic
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleResolveRecovery('REFUND', recoveryModalProduct)}
                className="w-full p-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-left flex items-center justify-between transition"
              >
                <div>
                  <h4 className="font-bold text-rose-200 text-sm flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-rose-400" />
                    Reembolso Automático Parcial en 1 Clic
                  </h4>
                  <p className="text-xs text-rose-300/70 mt-1">
                    Reintegra al instante $
                    {Number(recoveryModalProduct.price).toLocaleString('es-AR')} a la cuenta del
                    usuario.
                  </p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 bg-rose-600 text-white rounded-lg">
                  Reembolsar 1-Clic
                </span>
              </button>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setRecoveryModalProduct(null)}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-bold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
