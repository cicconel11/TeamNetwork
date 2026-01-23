/**
 * Unified Design Tokens
 * Premium mobile UI system inspired by Uber/Slack aesthetics
 */

// Neutral palette (app chrome - never changes based on org theme)
export const NEUTRAL = {
  // Backgrounds
  background: "#f8fafc",      // slate-50 - main content
  surface: "#ffffff",         // cards, sheets
  surfaceElevated: "#ffffff", // elevated cards

  // Text hierarchy
  foreground: "#0f172a",      // slate-900 - primary text
  secondary: "#475569",       // slate-600 - secondary text
  muted: "#64748b",           // slate-500 - tertiary
  placeholder: "#94a3b8",     // slate-400
  disabled: "#cbd5e1",        // slate-300

  // Borders & dividers
  border: "#e2e8f0",          // slate-200
  borderStrong: "#cbd5e1",    // slate-300
  divider: "#f1f5f9",         // slate-100

  // Dark variants (for header/tab bar)
  dark900: "#0f172a",
  dark950: "#020617",
  dark800: "#1e293b",

  // Overlays
  overlay: "rgba(15, 23, 42, 0.5)",
  overlayLight: "rgba(15, 23, 42, 0.1)",
} as const;

// Semantic colors (status & actions - consistent across orgs)
export const SEMANTIC = {
  // Success
  success: "#059669",         // emerald-600
  successLight: "#d1fae5",    // emerald-100
  successDark: "#047857",     // emerald-700

  // Warning
  warning: "#d97706",         // amber-600
  warningLight: "#fef3c7",    // amber-100
  warningDark: "#b45309",     // amber-700

  // Error
  error: "#dc2626",           // red-600
  errorLight: "#fee2e2",      // red-100
  errorDark: "#b91c1c",       // red-700

  // Info
  info: "#0284c7",            // sky-600
  infoLight: "#e0f2fe",       // sky-100
  infoDark: "#0369a1",        // sky-700
} as const;

// Sports energy accents
export const ENERGY = {
  // Live event indicator
  live: "#ef4444",            // red-500
  liveGlow: "rgba(239, 68, 68, 0.2)",
  livePulse: "rgba(239, 68, 68, 0.4)",

  // Achievements/celebrations
  gold: "#eab308",            // yellow-500
  goldLight: "#fef9c3",       // yellow-100

  // Active/online
  online: "#22c55e",          // green-500
  away: "#f59e0b",            // amber-500
  offline: "#94a3b8",         // slate-400
} as const;

// Role badge colors
export const ROLE_COLORS = {
  admin: {
    background: "#ede9fe",    // violet-100
    text: "#7c3aed",          // violet-600
  },
  member: {
    background: "#e0f2fe",    // sky-100
    text: "#0369a1",          // sky-700
  },
  alumni: {
    background: "#fef3c7",    // amber-100
    text: "#b45309",          // amber-700
  },
} as const;

// RSVP state colors
export const RSVP_COLORS = {
  going: {
    background: "#d1fae5",    // emerald-100
    text: "#047857",          // emerald-700
    border: "#a7f3d0",        // emerald-200
  },
  maybe: {
    background: "#fef3c7",    // amber-100
    text: "#b45309",          // amber-700
    border: "#fde68a",        // amber-200
  },
  declined: {
    background: "#f1f5f9",    // slate-100
    text: "#64748b",          // slate-500
    border: "#e2e8f0",        // slate-200
  },
} as const;

// Spacing scale (8pt grid)
export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

// Border radius scale
export const RADIUS = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

// Shadow definitions
export const SHADOWS = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

// Avatar sizes
export const AVATAR_SIZES = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
  xxl: 80,
} as const;

// Presence indicator sizes (relative to avatar)
export const PRESENCE_SIZES = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 18,
} as const;

// Animation timing
export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 350,
  spring: {
    damping: 15,
    stiffness: 300,
  },
} as const;

// Type exports for convenience
export type NeutralColors = typeof NEUTRAL;
export type SemanticColors = typeof SEMANTIC;
export type EnergyColors = typeof ENERGY;
export type RoleColors = typeof ROLE_COLORS;
export type RSVPColors = typeof RSVP_COLORS;
export type Spacing = typeof SPACING;
export type Radius = typeof RADIUS;
export type Shadows = typeof SHADOWS;
export type AvatarSizes = typeof AVATAR_SIZES;
