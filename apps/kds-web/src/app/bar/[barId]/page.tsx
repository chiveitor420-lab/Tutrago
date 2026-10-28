'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Printer,
  QrCode,
  CheckCircle,
  Bell,
  Clock,
  ArrowRight,
  ShieldAlert,
  Volume2,
  Sparkles,
} from 'lucide-react';
import { EscPosThermalPrinter } from '@/lib/thermal-print/escpos';

interface KdsTicket {
  id: string;
  shortCode: string;
  securityColor: string;
  status: 'IN_PREPARATION' | 'READY_FOR_PICKUP' | 'DELIVERED';
  activatedAt: string;
  items: Array<{
    name: string;
    quantity: number;
  }>;
}

export default function BarKdsPage() {
  const params = useParams();
  const barId = (params?.barId as string) || 'bar-pista-123';
  const barName = 'Barra Pista Central';

  const [tickets, setTickets] = useState<KdsTicket[]>([
    {
      id: 'ticket-demo-1',
      shortCode: 'A47',
      securityColor: '#10B981', // Verde Esmeralda
      status: 'IN_PREPARATION',
      activatedAt: new Date(Date.now() - 3 * 60000).toISOString(),
      items: [
        { name: 'Fernet Branca con Coca-Cola', quantity: 2 },
        { name: 'Gin Tonic Nacional', quantity: 1 },
      ],
    },
    {
      id: 'ticket-demo-2',
      shortCode: 'B12',
      securityColor: '#3B82F6', // Azul Eléctrico
      status: 'IN_PREPARATION',
      activatedAt: new Date(Date.now() - 1 * 60000).toISOString(),
      items: [
        { name: 'Vodka Smirnoff con Red Bull', quantity: 1 },
      ],
    },
    {
      id: 'ticket-demo-3',
      shortCode: 'C89',
      securityColor: '#F59E0B', // Ámbar
      status: 'READY_FOR_PICKUP',
      activatedAt: new Date(Date.now() - 6 * 60000).toISOString(),
      items: [
        { name: 'Cerveza Corona 330ml', quantity: 2 },
      ],
    },
  ]);

  const [scannerBuffer, setScannerBuffer] = useState('');
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanAlert, setScanAlert] = useState<{ type: 'SUCCESS' | 'ERROR'; message: string } | null>(null);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);

  // 1. Soporte para Pistola Lectora QR USB (captura ráfaga rápida de teclado terminada en Enter)
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      // Si el tiempo entre teclas es mayor a 60ms, es humano escribiendo; si es menor, es el láser USB
      if (now - lastKeyTime > 60) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          handleValidateScan(buffer.trim());
          buffer = '';
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tickets]);

  // 2. Disparo de Impresión ESC/POS
  const triggerPrint = async (ticket: KdsTicket) => {
    const printData = {
      barName,
      shortCode: ticket.shortCode,
      securityColor: ticket.securityColor,
      activatedAt: ticket.activatedAt,
      items: ticket.items,
    };

    // Intento con WebSerial
    const printedSerial = await EscPosThermalPrinter.printViaWebSerial(printData);
    if (!printedSerial) {
      // Fallback a ventana HTML/CSS de 80mm
      EscPosThermalPrinter.printViaHtmlFallback(printData);
    }
  };

  // 3. Avance de estados con 1 clic (IN_PREPARATION -> READY_FOR_PICKUP -> DELIVERED)
  const advanceTicket = (ticketId: string, nextStatus: 'READY_FOR_PICKUP' | 'DELIVERED') => {
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: nextStatus } : t))
    );

    // Audio beep de confirmación táctil en la barra
    if (typeof window !== 'undefined') {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = nextStatus === 'READY_FOR_PICKUP' ? 880 : 1200;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } catch (e) {
        // Ignorar si el audio está bloqueado por el navegador
      }
    }
  };

  // 4. Validación de QR escaneado (USB o manual)
  const handleValidateScan = (code: string) => {
    const cleanCode = code.toUpperCase().trim();
    const found = tickets.find(
      (t) => t.shortCode.toUpperCase() === cleanCode || t.id === cleanCode
    );

    if (!found) {
      setScanAlert({
        type: 'ERROR',
        message: `Código #${cleanCode} no encontrado en la barra.`,
      });
      return;
    }

    if (found.status === 'DELIVERED') {
      setScanAlert({
        type: 'ERROR',
        message: `¡ALERTA ROJA! El ticket #${found.shortCode} ya fue entregado previamente. Posible fraude de captura.`,
      });
      return;
    }

    // Entregar ticket exitosamente
    advanceTicket(found.id, 'DELIVERED');
    setScanAlert({
      type: 'SUCCESS',
      message: `¡Ticket #${found.shortCode} validado y entregado con éxito!`,
    });
    setManualCode('');

    setTimeout(() => setScanAlert(null), 3000);
  };

  const inPrepTickets = tickets.filter((t) => t.status === 'IN_PREPARATION');
  const readyTickets = tickets.filter((t) => t.status === 'READY_FOR_PICKUP');
  const deliveredTickets = tickets.filter((t) => t.status === 'DELIVERED');

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#09090B]">
      {/* Barra superior de estado */}
      <header className="h-16 border-b border-zinc-800 px-6 flex items-center justify-between bg-zinc-950/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold">
            KDS
          </div>
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2">
              {barName}
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            </h1>
            <p className="text-xs text-zinc-400">Terminal Táctil y Despacho Rápido</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setAutoPrintEnabled(!autoPrintEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-2 ${
              autoPrintEnabled
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            <Printer className="w-4 h-4" />
            Auto-Impresión 80mm: {autoPrintEnabled ? 'ACTIVADA' : 'MANUAL'}
          </button>

          <button
            onClick={() => setScanModalOpen(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-600/20 transition min-h-[44px]"
          >
            <QrCode className="w-5 h-5" />
            Escanear QR / Pistola
          </button>

          <a
            href="/stock"
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold border border-zinc-700 text-zinc-300"
          >
            Switches Stock
          </a>
        </div>
      </header>

      {/* Alerta flotante de escaneo */}
      {scanAlert && (
        <div
          className={`mx-6 mt-3 p-4 rounded-xl border text-sm font-bold flex items-center gap-3 animate-bounce ${
            scanAlert.type === 'SUCCESS'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500 text-rose-200'
          }`}
        >
          {scanAlert.type === 'SUCCESS' ? (
            <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
          )}
          <span>{scanAlert.message}</span>
        </div>
      )}

      {/* Tablero Kanban de 3 columnas */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Columna 1: EN PREPARACIÓN / IMPRIMIENDO */}
        <div className="flex flex-col bg-zinc-900/60 rounded-2xl border border-zinc-800/80 overflow-hidden">
          <div className="p-3.5 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wide text-zinc-300 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              EN PREPARACIÓN / IMPRIMIENDO
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 font-bold text-xs">
              {inPrepTickets.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {inPrepTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="p-4 rounded-xl bg-zinc-950 border-2 transition shadow-lg flex flex-col justify-between"
                style={{ borderColor: ticket.securityColor }}
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span
                      className="text-4xl font-black tracking-tight px-3 py-1 rounded-lg text-white"
                      style={{ backgroundColor: `${ticket.securityColor}33`, color: ticket.securityColor }}
                    >
                      #{ticket.shortCode}
                    </span>
                    <button
                      onClick={() => triggerPrint(ticket)}
                      title="Reimprimir comanda física"
                      className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Detalle de bebidas */}
                  <div className="mt-4 space-y-2 border-t border-zinc-800/80 pt-3">
                    {ticket.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-base font-bold text-zinc-100">
                        <span className="text-zinc-400">[{item.quantity}x]</span>
                        <span className="text-right flex-1 ml-2">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-xs text-zinc-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(ticket.activatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </div>

                  <button
                    onClick={() => advanceTicket(ticket.id, 'READY_FOR_PICKUP')}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition min-h-[48px]"
                  >
                    <Bell className="w-4 h-4" />
                    AVISAR LISTO
                  </button>
                </div>
              </div>
            ))}

            {inPrepTickets.length === 0 && (
              <div className="h-40 flex items-center justify-center text-zinc-600 text-sm font-semibold">
                Sin pedidos en preparación
              </div>
            )}
          </div>
        </div>

        {/* Columna 2: LISTOS EN MOSTRADOR */}
        <div className="flex flex-col bg-zinc-900/60 rounded-2xl border border-zinc-800/80 overflow-hidden">
          <div className="p-3.5 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wide text-zinc-300 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              LISTOS EN MOSTRADOR (FAST PICKUP)
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-xs">
              {readyTickets.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {readyTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="p-4 rounded-xl bg-zinc-950 border-2 border-emerald-500/80 shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-4xl font-black text-emerald-400">
                      #{ticket.shortCode}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold flex items-center gap-1">
                      <Volume2 className="w-3.5 h-3.5" /> Celular Vibrando
                    </span>
                  </div>

                  <div className="mt-3 space-y-1.5 border-t border-zinc-800 pt-2 text-sm text-zinc-300">
                    {ticket.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between font-semibold">
                        <span>[{item.quantity}x]</span>
                        <span>{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-end">
                  <button
                    onClick={() => advanceTicket(ticket.id, 'DELIVERED')}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition min-h-[52px]"
                  >
                    <CheckCircle className="w-5 h-5" />
                    ENTREGAR BEBIDA
                  </button>
                </div>
              </div>
            ))}

            {readyTickets.length === 0 && (
              <div className="h-40 flex items-center justify-center text-zinc-600 text-sm font-semibold">
                Ningún cliente esperando en mostrador
              </div>
            )}
          </div>
        </div>

        {/* Columna 3: HISTORIAL RECIENTE */}
        <div className="flex flex-col bg-zinc-900/60 rounded-2xl border border-zinc-800/80 overflow-hidden">
          <div className="p-3.5 border-b border-zinc-800 bg-zinc-900 flex justify-between items-center">
            <h2 className="font-black text-sm tracking-wide text-zinc-400 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-zinc-500"></span>
              HISTORIAL RECIENTE (ENTREGADOS)
            </h2>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-bold text-xs">
              {deliveredTickets.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 opacity-70">
            {deliveredTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold text-sm text-zinc-300">#{ticket.shortCode}</span>
                  <p className="text-zinc-500">
                    {ticket.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                  </p>
                </div>
                <span className="text-emerald-500 font-bold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Entregado
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Modal de Validación Manual / Escaneo */}
      {scanModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                <QrCode className="w-5 h-5 text-blue-400" />
                Validar Ticket / Pistola USB
              </h3>
              <button
                onClick={() => setScanModalOpen(false)}
                className="text-zinc-400 hover:text-white font-bold text-sm"
              >
                Cerrar
              </button>
            </div>

            <p className="text-xs text-zinc-400 mb-4">
              Pasa la pistola láser por el código QR del cliente o escribe su código de 3 caracteres (ej: A47):
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleValidateScan(manualCode);
                setScanModalOpen(false);
              }}
            >
              <input
                autoFocus
                type="text"
                placeholder="Ej: A47"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="w-full text-center text-3xl font-black uppercase tracking-widest py-3 rounded-xl bg-zinc-950 border-2 border-blue-500 text-white focus:outline-none mb-4"
              />

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-white transition min-h-[48px]"
              >
                Validar y Marcar Entregado
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
