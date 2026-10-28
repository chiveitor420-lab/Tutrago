// ==========================================
// TOKENS DE DISEÑO: ENTORNO HOSTIL NOCTURNO (60-30-10)
// ==========================================

export const THEME_COLORS = {
  // 60% Color Dominante (OLED Dark Mode - no encandila, ahorro de batería)
  background: {
    base: '#09090B',       // Zinc 950
    subtle: '#121215',     // Ligeramente elevado
  },
  // 30% Estructura y Superficies (Contraste medio)
  surface: {
    card: '#18181B',       // Zinc 900
    cardHover: '#27272A',  // Zinc 800
    border: '#27272A',     // Zinc 800
    borderSubtle: '#3F3F46', // Zinc 700
  },
  // Tipografía de Alto Contraste
  text: {
    primary: '#FAFAFA',    // Zinc 50
    secondary: '#A1A1AA',  // Zinc 400
    muted: '#71717A',      // Zinc 500
    inverted: '#09090B',   // Zinc 950
  },
  // 10% Acentos y Feedback de Acción
  accent: {
    primary: '#3B82F6',    // Azul Eléctrico (Call to action principal)
    primaryHover: '#2563EB',
    success: '#10B981',    // Verde Listo (Pedido en barra)
    warning: '#F59E0B',    // Ámbar (En cola / demora)
    danger: '#EF4444',     // Rojo (Cancelado / error)
  },
  // 8 Colores Rotativos de Seguridad para Validación Visual Anti-Ruido
  security: [
    { name: 'Rojo Neón', hex: '#EF4444' },
    { name: 'Azul Eléctrico', hex: '#3B82F6' },
    { name: 'Verde Esmeralda', hex: '#10B981' },
    { name: 'Ámbar Intenso', hex: '#F59E0B' },
    { name: 'Violeta Neón', hex: '#8B5CF6' },
    { name: 'Fucsia Vibrante', hex: '#EC4899' },
    { name: 'Cian Resplandeciente', hex: '#06B6D4' },
    { name: 'Lima Ácido', hex: '#84CC16' },
  ],
} as const;

export const ERGONOMIC_RULES = {
  minTouchTargetPx: 56, // Altura mínima de botón en px para evitar toques erróneos
  hapticPatternReady: [0, 250, 100, 250], // Patrón de vibración doble al estar listo
  antiScreenshotFps: 60, // Tasa de refresco para barra de pulso antifraude
} as const;
