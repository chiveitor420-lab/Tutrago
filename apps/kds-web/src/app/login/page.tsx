'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wine,
  ShieldCheck,
  Lock,
  UserCheck,
  ArrowRight,
  BarChart3,
  Monitor,
  Sparkles,
  AlertCircle,
  Delete,
  RotateCcw,
  Terminal,
  CheckCircle2,
} from 'lucide-react';
import {
  getApiUrl,
  DEFAULT_TENANT_ID,
  saveStaffSession,
} from '@/lib/api-config';

interface BarItem {
  id: string;
  name: string;
  maxConcurrentPrep: number;
  printerType: string;
  status: string;
}

export default function StaffLoginPage() {
  const router = useRouter();
  const [roleTab, setRoleTab] = useState<'OWNER' | 'BARTENDER' | 'INCUBATIO_ADMIN'>('OWNER');
  const [email, setEmail] = useState('dueno@tutrago.com');
  const [pin, setPin] = useState('1234');
  const [selectedBarId, setSelectedBarId] = useState('00000000-0000-4000-8000-000000000101');
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/tenants/${DEFAULT_TENANT_ID}/bars?includeAll=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setBars(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleRoleSwitch = (nextRole: 'OWNER' | 'BARTENDER' | 'INCUBATIO_ADMIN') => {
    setRoleTab(nextRole);
    setError(null);
    if (nextRole === 'OWNER') {
      setEmail('dueno@tutrago.com');
      setPin('1234');
    } else if (nextRole === 'BARTENDER') {
      setEmail('pista@tutrago.com');
      setPin('1111');
    } else {
      setEmail('admin@incubatio.com');
      setPin('9999');
    }
  };

  const handleBarSelect = (barId: string, index: number) => {
    setSelectedBarId(barId);
    const emails = ['pista@tutrago.com', 'vip@tutrago.com', 'patio@tutrago.com'];
    const pins = ['1111', '2222', '3333'];
    setEmail(emails[index] || 'pista@tutrago.com');
    setPin(pins[index] || '1111');
  };

  const handleKeypadDigit = (digit: string) => {
    setError(null);
    setPin((prev) => (prev.length < 6 ? prev + digit : prev));
  };

  const handleKeypadBackspace = () => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleKeypadClear = () => {
    setError(null);
    setPin('');
  };

  const performLogin = async (
    loginEmail: string,
    loginPin: string,
    loginRole: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER',
    barIdToUse?: string
  ) => {
    if (!loginPin || loginPin.trim().length < 4) {
      setError('Ingresa un PIN operativo válido de al menos 4 dígitos.');
      return;
    }

    setLoading(true);
    setError(null);

    const targetBarId = barIdToUse || selectedBarId;
    const apiUrl = getApiUrl();

    try {
      const res = await fetch(`${apiUrl}/tenants/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          pin: loginPin,
          role: loginRole,
          barId: loginRole === 'BARTENDER' ? targetBarId : undefined,
          tenantId: DEFAULT_TENANT_ID,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Credenciales inválidas. Verifica tu PIN operativo.');
      }

      const data = await res.json();
      saveStaffSession({
        email: data.user.email,
        name: data.user.name,
        role: data.user.role,
        tenantId: data.user.tenantId || DEFAULT_TENANT_ID,
        barId: data.user.barId,
        barName: data.user.barName,
        token: data.token,
      });

      router.push(data.redirectUrl);
    } catch (err: any) {
      if (
        err.message?.includes('PIN') ||
        err.message?.includes('Credenciales') ||
        err.message?.includes('incorrecto')
      ) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const fallbackRedirect =
        loginRole === 'BARTENDER' ? `/bar/${targetBarId}` : '/admin';
      saveStaffSession({
        email: loginEmail,
        name:
          loginRole === 'BARTENDER'
            ? 'Operador de Barra (KDS)'
            : loginRole === 'INCUBATIO_ADMIN'
              ? 'Admin Incubatio'
              : 'Dueño del Local',
        role: loginRole,
        tenantId: DEFAULT_TENANT_ID,
        barId: loginRole === 'BARTENDER' ? targetBarId : null,
        token: `local-jwt-${Date.now()}`,
      });
      router.push(fallbackRedirect);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLogin(email, pin, roleTab, selectedBarId);
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col justify-between relative overflow-hidden">
      {/* Iluminación ambiental sutil estilo Linear / Vercel */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/60 via-[#09090B] to-[#09090B]" />

      {/* Header Minimalista Industrial */}
      <header className="relative z-10 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md px-6 py-3.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-white shadow-inner">
              <Wine className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-black tracking-wider text-white">TUTRAGO</span>
              <span className="text-zinc-700">/</span>
              <span className="text-xs font-semibold text-zinc-300">
                Club Nocturno Tutrago Central
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Terminal Activa
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleRoleSwitch('INCUBATIO_ADMIN')}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition flex items-center gap-1.5 ${
                roleTab === 'INCUBATIO_ADMIN'
                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                  : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              SuperAdmin
            </button>
            <a
              href="/"
              className="text-xs font-semibold text-zinc-400 hover:text-white transition"
            >
              Inicio
            </a>
          </div>
        </div>
      </header>

      {/* Cuerpo Principal: Selector de Perfil + Teclado Numérico Táctil */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Columna Izquierda (7 cols): Selector Visual de Perfil y Configuración de Destino */}
          <div className="lg:col-span-7 flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-zinc-900/50 border border-zinc-800/90 backdrop-blur-sm shadow-2xl">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-blue-400" />
                  PASO 1 · SELECCIÓN DE PERFIL OPERATIVO
                </span>
                <span className="text-[11px] font-mono text-zinc-500">RBAC + JWT</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white mb-1">
                Ingreso a Consola Operativa
              </h1>
              <p className="text-xs text-zinc-400 mb-6">
                Elige tu función de turno para dirigirte al Panel Ejecutivo o al Monitor KDS de Barra.
              </p>

              {/* Tarjetas Grandes de Selección Visual: Dueño de Local vs Operador de Barra */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-6">
                <button
                  type="button"
                  onClick={() => handleRoleSwitch('OWNER')}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between min-h-[132px] ${
                    roleTab === 'OWNER'
                      ? 'bg-blue-950/30 border-blue-500 shadow-[0_0_25px_-5px_rgba(59,130,246,0.35)]'
                      : 'bg-zinc-950/70 border-zinc-800/90 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                        roleTab === 'OWNER'
                          ? 'bg-blue-600 text-white border-blue-400'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      <BarChart3 className="w-5 h-5" />
                    </div>
                    {roleTab === 'OWNER' && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="text-base font-black text-white">Dueño de Local</div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                      Bento Grid en vivo, Carta & Upsells, Pósters QR y Finanzas →{' '}
                      <code className="text-blue-400 font-mono">/admin</code>
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleRoleSwitch('BARTENDER')}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between min-h-[132px] ${
                    roleTab === 'BARTENDER'
                      ? 'bg-emerald-950/30 border-emerald-500 shadow-[0_0_25px_-5px_rgba(16,185,129,0.35)]'
                      : 'bg-zinc-950/70 border-zinc-800/90 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                        roleTab === 'BARTENDER'
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      <Monitor className="w-5 h-5" />
                    </div>
                    {roleTab === 'BARTENDER' && (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        Seleccionado
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="text-base font-black text-white">Operador de Barra</div>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                      Monitor KDS táctil 3 columnas, Escáner QR y Stock 1-Toque →{' '}
                      <code className="text-emerald-400 font-mono">/bar</code>
                    </p>
                  </div>
                </button>
              </div>

              {/* Selector de Barra si es Operador de Barra, o Cuenta Activa si es Dueño */}
              {roleTab === 'BARTENDER' ? (
                <div className="space-y-2.5 mb-4">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
                    Terminal de Barra Asignada
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {bars.map((bar, idx) => {
                      const active = selectedBarId === bar.id;
                      return (
                        <button
                          key={bar.id}
                          type="button"
                          onClick={() => handleBarSelect(bar.id, idx)}
                          className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                            active
                              ? 'bg-emerald-950/40 border-emerald-500 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-zinc-500">
                              #{idx + 1} · {bar.maxConcurrentPrep} FIFO
                            </span>
                            {active && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <div className="text-xs font-black mt-1 truncate">{bar.name}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/90 mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Identificador de Cuenta
                    </label>
                    <span className="text-[11px] font-mono text-blue-400">
                      {roleTab === 'INCUBATIO_ADMIN' ? 'SuperAdmin Multi-Tenant' : 'Gerencia Local'}
                    </span>
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dueno@tutrago.com"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {error && (
                <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-bold flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Resumen de redirección */}
            <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-zinc-500" />
                <span>Destino:</span>
                {roleTab === 'BARTENDER' ? (
                  <code className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold">
                    /bar/{selectedBarId.slice(-3)}
                  </code>
                ) : (
                  <code className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-bold">
                    /admin
                  </code>
                )}
              </div>
              <span className="text-[11px] text-zinc-500">
                PIN Demo: {roleTab === 'BARTENDER' ? '1111' : roleTab === 'OWNER' ? '1234' : '9999'}
              </span>
            </div>
          </div>

          {/* Columna Derecha (5 cols): Teclado Numérico Táctil Industrial */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-5 p-6 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-2xl flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  PASO 2 · PIN OPERATIVO
                </span>
                <span className="text-[11px] font-semibold text-zinc-500">
                  {pin.length} / 4 dígitos
                </span>
              </div>

              {/* Visor de PIN Táctil de Alto Contraste */}
              <div className="relative mb-4">
                <input
                  type="password"
                  required
                  maxLength={8}
                  value={pin}
                  onChange={(e) => {
                    setError(null);
                    setPin(e.target.value);
                  }}
                  aria-label="PIN Operativo"
                  placeholder="••••"
                  className="w-full h-16 px-4 rounded-2xl bg-zinc-950 border-2 border-zinc-800 focus:border-blue-500 text-center text-3xl font-black tracking-[0.6em] text-white focus:outline-none transition"
                />
              </div>

              {/* Grilla Numérica Táctil Grande (Square KDS Style) */}
              <div className="grid grid-cols-3 gap-2.5 select-none">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handleKeypadDigit(digit)}
                    className="h-14 rounded-xl bg-zinc-950 hover:bg-zinc-800 active:scale-95 border border-zinc-800/90 text-xl font-black text-white transition flex items-center justify-center shadow-sm"
                  >
                    {digit}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={handleKeypadClear}
                  title="Limpiar PIN"
                  className="h-14 rounded-xl bg-zinc-950/60 hover:bg-rose-950/40 active:scale-95 border border-zinc-800 text-xs font-extrabold uppercase text-zinc-400 hover:text-rose-300 transition flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-4 h-4" />
                  CLR
                </button>

                <button
                  type="button"
                  onClick={() => handleKeypadDigit('0')}
                  className="h-14 rounded-xl bg-zinc-950 hover:bg-zinc-800 active:scale-95 border border-zinc-800/90 text-xl font-black text-white transition flex items-center justify-center shadow-sm"
                >
                  0
                </button>

                <button
                  type="button"
                  onClick={handleKeypadBackspace}
                  title="Borrar dígito"
                  className="h-14 rounded-xl bg-zinc-950/60 hover:bg-zinc-800 active:scale-95 border border-zinc-800 text-zinc-300 transition flex items-center justify-center"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Botón Táctil de Confirmación */}
            <div className="mt-5">
              <button
                type="submit"
                disabled={loading}
                data-testid="login-submit-btn"
                className={`w-full py-4 px-5 rounded-xl font-black text-sm flex items-center justify-center gap-2.5 shadow-xl transition active:scale-[0.99] min-h-[56px] ${
                  roleTab === 'BARTENDER'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                    : roleTab === 'INCUBATIO_ADMIN'
                      ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/20'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                }`}
              >
                <UserCheck className="w-5 h-5" />
                <span>
                  {loading
                    ? 'Verificando PIN...'
                    : roleTab === 'BARTENDER'
                      ? 'Abrir Monitor de Barra KDS'
                      : 'Ingresar al Panel del Boliche'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Footer Integrado: Accesos Rápidos de Demostración en 1 Clic */}
      <footer className="relative z-10 border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-[11px] font-black uppercase tracking-wider text-zinc-300">
              Accesos Rápidos Demo (1-Clic):
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              data-testid="quick-login-owner"
              onClick={() => performLogin('dueno@tutrago.com', '1234', 'OWNER')}
              className="px-3 py-2 rounded-xl bg-blue-950/40 hover:bg-blue-900/50 border border-blue-500/30 text-xs font-bold text-blue-200 flex items-center gap-2 transition"
            >
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span>Dueño Local (/admin)</span>
            </button>

            {bars.map((b, idx) => {
              const pins = ['1111', '2222', '3333'];
              const emails = ['pista@tutrago.com', 'vip@tutrago.com', 'patio@tutrago.com'];
              return (
                <button
                  key={b.id}
                  type="button"
                  data-testid={`quick-login-bar-${idx}`}
                  onClick={() =>
                    performLogin(
                      emails[idx] || 'pista@tutrago.com',
                      pins[idx] || '1111',
                      'BARTENDER',
                      b.id
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-emerald-950/30 hover:bg-emerald-900/50 border border-emerald-500/30 text-xs font-bold text-emerald-200 flex items-center gap-1.5 transition"
                >
                  <Monitor className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{b.name}</span>
                </button>
              );
            })}

            <button
              type="button"
              data-testid="quick-login-incubatio"
              onClick={() => performLogin('admin@incubatio.com', '9999', 'INCUBATIO_ADMIN')}
              className="px-3 py-2 rounded-xl bg-violet-950/30 hover:bg-violet-900/50 border border-violet-500/30 text-xs font-bold text-violet-200 flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
              <span>Admin Incubatio</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
