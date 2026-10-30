'use client';

import Link from 'next/navigation';
import { Wine, Monitor, Layers, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';

export default function KdsHomePage() {
  const bars = [
    { id: '00000000-0000-4000-8000-000000000101', name: 'Barra Pista Central', queue: 4, type: 'Principal (Impresora 80mm)' },
    { id: '00000000-0000-4000-8000-000000000102', name: 'Barra Terraza VIP', queue: 1, type: 'VIP Cocktails' },
    { id: '00000000-0000-4000-8000-000000000103', name: 'Barra Patio Electrónica', queue: 0, type: 'Patio Cervezas' },
  ];

  return (
    <div className="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full justify-center">
      <div className="flex items-center justify-between pb-6 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Wine className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              TUTRAGO <span className="text-xs px-2 py-0.5 rounded bg-blue-600/30 text-blue-400 border border-blue-500/30">KDS v2.0</span>
            </h1>
            <p className="text-sm text-zinc-400">Panel Operativo de Barra e Impresión Térmica</p>
          </div>
        </div>

        <a
          href="/stock"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold transition border border-zinc-700"
        >
          <Layers className="w-4 h-4 text-emerald-400" />
          Switches de Stock
        </a>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-bold text-zinc-200 mb-4 flex items-center gap-2">
          <Monitor className="w-5 h-5 text-zinc-400" />
          Selecciona la Terminal de Barra a Operar:
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bars.map((bar) => (
            <a
              key={bar.id}
              href={`/bar/${bar.id}`}
              className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-blue-500 transition-all flex flex-col justify-between group cursor-pointer hover:bg-zinc-800/60"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {bar.type}
                  </span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    ONLINE
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition">
                  {bar.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Capacidad máx: 15 comandas activas
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-sm font-medium text-zinc-300">
                <span>Abrir Monitor KDS</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition text-blue-400" />
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-8 p-4 rounded-xl bg-blue-950/20 border border-blue-900/40 text-xs text-blue-300 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
        <div>
          <b>Hardware Conectado:</b> Soporte activado para lectores QR por USB (pistola láser) y despacho automático a impresoras térmicas de 80mm vía WebSerial / ESC/POS.
        </div>
      </div>
    </div>
  );
}
