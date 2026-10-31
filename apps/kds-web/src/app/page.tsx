'use client';

import React, { useEffect, useState } from 'react';
import {
  Wine,
  Monitor,
  Layers,
  ShieldCheck,
  ArrowRight,
  BarChart3,
  LogIn,
  QrCode,
} from 'lucide-react';
import { getApiUrl, DEFAULT_TENANT_ID, getStaffSession } from '@/lib/api-config';

interface BarItem {
  id: string;
  name: string;
  maxConcurrentPrep: number;
  printerType: string;
  status: string;
}

export default function KdsHomePage() {
  const [bars, setBars] = useState<BarItem[]>([
    {
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Barra Pista Central',
      maxConcurrentPrep: 15,
      printerType: 'WEB_SERIAL_80MM',
      status: 'ACTIVE',
    },
    {
      id: '00000000-0000-4000-8000-000000000102',
      name: 'Barra Terraza VIP',
      maxConcurrentPrep: 10,
      printerType: 'WEB_USB_80MM',
      status: 'ACTIVE',
    },
    {
      id: '00000000-0000-4000-8000-000000000103',
      name: 'Barra Patio Electrónica',
      maxConcurrentPrep: 12,
      printerType: 'WEB_SERIAL_80MM',
      status: 'ACTIVE',
    },
  ]);

  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    const s = getStaffSession();
    if (s) setSessionName(`${s.name} (${s.role})`);

    fetch(`${getApiUrl()}/tenants/${DEFAULT_TENANT_ID}/bars?includeAll=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setBars(data);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col p-6 max-w-6xl mx-auto w-full justify-center">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Wine className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              TUTRAGO{' '}
              <span className="text-xs px-2 py-0.5 rounded bg-blue-600/30 text-blue-400 border border-blue-500/30">
                KDS & ADMIN v2.4
              </span>
            </h1>
            <p className="text-sm text-zinc-400">
              Plataforma Operativa de Barra, Administración del Boliche y Métricas en Vivo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-bold transition border border-zinc-700 text-zinc-200"
          >
            <LogIn className="w-4 h-4 text-blue-400" />
            {sessionName ? `Sesión: ${sessionName}` : 'Portal de Login (/login)'}
          </a>

          <a
            href="/admin"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-black text-white transition shadow-lg shadow-blue-600/20"
          >
            <BarChart3 className="w-4 h-4" />
            Panel del Boliche (/admin)
          </a>

          <a
            href="/stock"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold transition border border-zinc-700"
          >
            <Layers className="w-4 h-4 text-emerald-400" />
            Switches de Stock
          </a>
        </div>
      </div>

      {/* Acceso destacado a las 2 vistas diferenciadas */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
        <a
          href="/admin"
          className="p-6 rounded-2xl bg-gradient-to-br from-blue-950/50 to-zinc-900 border border-blue-500/40 hover:border-blue-400 transition flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-600/30 text-blue-300 border border-blue-500/40">
                VISTA DUEÑO DEL BOLICHE / ADMIN
              </span>
              <QrCode className="w-5 h-5 text-blue-400" />
            </div>
            <h2 className="text-xl font-black text-white group-hover:text-blue-300 transition">
              Panel de Control, ABM de Carta & Ventas en Vivo (/admin)
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Alta y edición de barras, cargador rápido de bebidas y opciones de Upsell para el
              piloto, generador de carteles QR listos para imprimir y tablero financiero minuto a
              minuto.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-blue-900/40 flex items-center justify-between text-xs font-extrabold text-blue-300">
            <span>Abrir Consola de Administración</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
          </div>
        </a>

        <a
          href="/login"
          className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/40 to-zinc-900 border border-emerald-500/40 hover:border-emerald-400 transition flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-600/30 text-emerald-300 border border-emerald-500/40">
                PORTAL DE INGRESO DE PERSONAL
              </span>
              <LogIn className="w-5 h-5 text-emerald-400" />
            </div>
            <h2 className="text-xl font-black text-white group-hover:text-emerald-300 transition">
              Acceso por Rol con Redirección Automática (/login)
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Identificación con PIN operativo para Dueños del Boliche, Administradores de
              Incubatio y Bartenders con derivación directa a su barra asignada.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-emerald-900/40 flex items-center justify-between text-xs font-extrabold text-emerald-300">
            <span>Ir al Portal de Login</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
          </div>
        </a>
      </div>

      <div className="mt-8">
        <h2 className="text-base font-bold text-zinc-200 mb-4 flex items-center gap-2">
          <Monitor className="w-5 h-5 text-emerald-400" />
          Terminales de Barra Activas (Monitor KDS de Despacho Rápido):
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bars.map((bar) => (
            <a
              key={bar.id}
              href={`/bar/${bar.id}`}
              className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-emerald-500 transition-all flex flex-col justify-between group cursor-pointer hover:bg-zinc-800/60"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {bar.printerType}
                  </span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {bar.status}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition">
                  {bar.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Límite FIFO Redis: {bar.maxConcurrentPrep} comandas simultáneas
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-sm font-bold text-zinc-300">
                <span>Abrir Monitor KDS</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition text-emerald-400" />
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-8 p-4 rounded-xl bg-blue-950/20 border border-blue-900/40 text-xs text-blue-300 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
        <div>
          <b>Hardware & Tiempo Real Conectado:</b> Soporte activado para cámara y lectores QR por
          USB (pistola láser), Service Recovery en 1 clic y despacho automático a impresoras
          térmicas de 80mm vía WebUSB / WebSerial / ESC/POS.
        </div>
      </div>
    </div>
  );
}
