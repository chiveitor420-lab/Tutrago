'use client';

import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, RefreshCw, DollarSign, Sparkles } from 'lucide-react';

interface ProductStock {
  id: string;
  name: string;
  category: string;
  price: number;
  isAvailable: boolean;
}

export default function StockSwitchboardPage() {
  const [products, setProducts] = useState<ProductStock[]>([
    { id: '1', name: 'Fernet Branca con Coca-Cola', category: 'Tragos Clásicos', price: 9500, isAvailable: true },
    { id: '2', name: 'Gin Tonic Nacional', category: 'Gin & Cocktails', price: 8500, isAvailable: true },
    { id: '3', name: 'Vodka Smirnoff con Red Bull', category: 'Tragos con Energizante', price: 11000, isAvailable: true },
    { id: '4', name: 'Campari Orange', category: 'Tragos Clásicos', price: 8000, isAvailable: false },
    { id: '5', name: 'Mojito Clásico Cubano', category: 'Cocktails', price: 9000, isAvailable: true },
    { id: '6', name: 'Cerveza Corona 330ml', category: 'Cervezas', price: 5500, isAvailable: true },
    { id: '7', name: 'Cerveza Patagonia Bohemian 730ml', category: 'Cervezas', price: 8500, isAvailable: true },
    { id: '8', name: 'Whisky Johnnie Walker Red', category: 'Whiskies', price: 10500, isAvailable: true },
    { id: '9', name: 'Aperol Spritz', category: 'Cocktails', price: 9000, isAvailable: true },
    { id: '10', name: 'Combo VIP: Chandon + 4 Speed', category: 'Combos VIP', price: 36000, isAvailable: true },
    { id: '11', name: 'Combo VIP: Jagermeister + 4 Red Bull', category: 'Combos VIP', price: 48000, isAvailable: false },
    { id: '12', name: 'Red Bull Energy Drink 250ml', category: 'Sin Alcohol', price: 4500, isAvailable: true },
    { id: '13', name: 'Agua Mineral Eco 500ml', category: 'Sin Alcohol', price: 3000, isAvailable: true },
    { id: '14', name: 'Gaseosa Coca-Cola Original', category: 'Sin Alcohol', price: 3500, isAvailable: true },
    { id: '15', name: 'Shot Tequila José Cuervo', category: 'Shots', price: 5000, isAvailable: true },
  ]);

  const [recoveryModalProduct, setRecoveryModalProduct] = useState<ProductStock | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const toggleAvailability = (id: string) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id === id) {
          const updated = !p.isAvailable;
          if (!updated) {
            // Si se apaga, sugerir flujo de service recovery
            console.log(`[Stock] Producto ${p.name} marcado como AGOTADO. Notificando a WebSockets.`);
          }
          return { ...p, isAvailable: updated };
        }
        return p;
      })
    );
  };

  const handleResolveRecovery = (type: 'SUBSTITUTE' | 'REFUND', productName: string) => {
    setActionSuccess(
      type === 'SUBSTITUTE'
        ? `¡Sustitución de ${productName} autorizada en barra por bebida equivalente!`
        : `¡Reembolso automático de ${productName} emitido vía Mercado Pago!`
    );
    setRecoveryModalProduct(null);
    setTimeout(() => setActionSuccess(null), 3500);
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
                EN VIVO
              </span>
            </h1>
            <p className="text-sm text-zinc-400">
              Modifica la disponibilidad instantánea de bebidas en la App de clientes y KDS.
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

      {/* Grid de productos con switches gigantes */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => (
          <div
            key={product.id}
            className={`p-5 rounded-2xl border transition flex flex-col justify-between ${
              product.isAvailable
                ? 'bg-zinc-900/80 border-zinc-800'
                : 'bg-rose-950/20 border-rose-900/60 opacity-90'
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {product.category}
                </span>
                <span className="text-sm font-black text-zinc-200">
                  ${product.price.toLocaleString('es-AR')}
                </span>
              </div>

              <h3 className="text-base font-bold text-white mb-1">
                {product.name}
              </h3>

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
                onClick={() => toggleAvailability(product.id)}
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
                  onClick={() => setRecoveryModalProduct(product)}
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

      {/* Modal de Service Recovery */}
      {recoveryModalProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-amber-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-black text-white">
                Service Recovery: {recoveryModalProduct.name}
              </h3>
            </div>

            <p className="text-sm text-zinc-300 mb-4">
              Si un cliente compró esta bebida antes del agotamiento y se presenta en barra a retirarla, puedes resolver la contingencia en 1 clic:
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleResolveRecovery('SUBSTITUTE', recoveryModalProduct.name)}
                className="w-full p-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-left flex items-center justify-between transition"
              >
                <div>
                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-blue-400" />
                    Sustituir por Trago Equivalente
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    Entrega una bebida de igual o mayor valor de la misma categoría sin costo extra.
                  </p>
                </div>
                <span className="text-xs font-bold px-2 py-1 bg-blue-600 text-white rounded">
                  Reemplazar
                </span>
              </button>

              <button
                onClick={() => handleResolveRecovery('REFUND', recoveryModalProduct.name)}
                className="w-full p-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-left flex items-center justify-between transition"
              >
                <div>
                  <h4 className="font-bold text-rose-200 text-sm flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-rose-400" />
                    Reembolso Automático Parcial
                  </h4>
                  <p className="text-xs text-rose-300/70 mt-1">
                    Reintegra al instante ${recoveryModalProduct.price.toLocaleString('es-AR')} a la cuenta del usuario.
                  </p>
                </div>
                <span className="text-xs font-bold px-2 py-1 bg-rose-600 text-white rounded">
                  Reembolsar
                </span>
              </button>
            </div>

            <div className="mt-6 flex justify-end">
              <button
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
