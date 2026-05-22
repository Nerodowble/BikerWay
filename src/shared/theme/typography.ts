export const typography = {
  sizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 36,
  } as const,
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  } as const,
  // Main navigation info - minimum 18pt per design doc for readability with vibration
  navPrimary: {
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 28,
  },
  // Secondary navigation info - minimum 14pt per design doc
  navSecondary: {
    fontSize: 16,
    fontWeight: '500' as const,
    lineHeight: 22,
  },
  buttonLabel: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 1,
    lineHeight: 14,
    textTransform: 'uppercase' as const,
  },
  display: {
    fontSize: 28,
    fontWeight: '800' as const,
    lineHeight: 32,
  },
} as const;

export type TypographySizeKey = keyof typeof typography.sizes;
export type TypographyWeightKey = keyof typeof typography.weights;
