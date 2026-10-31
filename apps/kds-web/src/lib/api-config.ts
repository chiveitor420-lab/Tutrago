export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_TENANT_SLUG = 'club-tutrago';

export function getApiUrl(): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

export function getWsUrl(): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  return process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
}

export function getClientAppBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:8081';
  }
  return process.env.NEXT_PUBLIC_CLIENT_APP_URL || 'https://tutrago-app.vercel.app';
}

export interface StaffSession {
  email: string;
  name: string;
  role: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER';
  tenantId: string;
  barId?: string | null;
  barName?: string | null;
  token: string;
}

const SESSION_KEY = 'tutrago_staff_session';

export function saveStaffSession(session: StaffSession) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

export function getStaffSession(): StaffSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export function clearStaffSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function getStaffAuthHeaders(
  extraHeaders: Record<string, string> = {},
  options?: {
    defaultRole?: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER';
    barId?: string;
  }
): Record<string, string> {
  const sess = getStaffSession();
  const fallbackRole = (options?.defaultRole || 'OWNER').toLowerCase();
  const token = sess?.token || `tutrago-staff-jwt-${fallbackRole}-bootstrap`;
  const resolvedBarId = options?.barId || sess?.barId || '';

  return {
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': sess?.tenantId || DEFAULT_TENANT_ID,
    ...(resolvedBarId ? { 'X-Bar-Id': resolvedBarId } : {}),
    ...extraHeaders,
  };
}

export async function ensureSignedStaffSession(options?: {
  defaultRole?: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER';
  barId?: string;
}): Promise<StaffSession | null> {
  const existing = getStaffSession();
  // Si ya posee un JWT firmado de 3 segmentos y coincide el barId (si aplica), reutilizarlo
  if (
    existing?.token &&
    existing.token.split('.').length === 3 &&
    (!options?.barId || !existing.barId || existing.barId === options.barId)
  ) {
    return existing;
  }

  const role = existing?.role || options?.defaultRole || 'OWNER';
  const barId = options?.barId || existing?.barId || undefined;
  try {
    const res = await fetch(`${getApiUrl()}/tenants/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: existing?.email,
        role,
        barId,
        tenantId: existing?.tenantId || DEFAULT_TENANT_ID,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.token && data?.user) {
        const nextSession: StaffSession = {
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          tenantId: data.user.tenantId || DEFAULT_TENANT_ID,
          barId: data.user.barId,
          barName: data.user.barName,
          token: data.token,
        };
        saveStaffSession(nextSession);
        return nextSession;
      }
    }
  } catch {
    // Fallback a cabeceras bootstrap si la red está temporalmente offline
  }
  return existing;
}
