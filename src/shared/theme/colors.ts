export const colors = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceMuted: '#252525',
  surfaceElevated: '#2A2A2A',
  border: '#333333',
  borderSubtle: '#2A2A2A',
  textPrimary: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textMuted: '#7A7A7A',
  accent: '#FF6B00',
  accentDark: '#CC5600',
  warning: '#FFCC00',
  danger: '#D32F2F',
  success: '#3FBF6F',
  overlay: 'rgba(0,0,0,0.6)',
} as const;

export type AppColor = keyof typeof colors;
