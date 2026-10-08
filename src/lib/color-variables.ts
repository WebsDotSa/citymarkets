/**
 * Color Variables System
 *
 * Converts dynamic colors (BRAND, vendor colors, status colors) to CSS variables
 * for use in inline styles without hardcoding hex values.
 *
 * Usage:
 *   const colors = { primary: '#009345', secondary: '#ff0000' }
 *   const style = setCSSVars(colors)
 *   // style = { '--primary': '#009345', '--secondary': '#ff0000' }
 */

import type { CSSProperties } from 'react';
import { BRAND } from './brand-theme';

/**
 * CSS Variable name conversions
 * Converts camelCase to kebab-case for CSS variable names
 */
export function getCSSVarName(key: string): string {
  return `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

/**
 * Set CSS variables from a color object
 * Returns a style object ready for inline style usage
 *
 * @example
 * setCSSVars({ primary: '#009345', brandGreen: '#00b366' })
 * // Returns: { '--primary': '#009345', '--brand-green': '#00b366' }
 */
export function setCSSVars(
  colors: Record<string, string | undefined>
): CSSProperties {
  const style: CSSProperties = {};

  Object.entries(colors).forEach(([key, value]) => {
    if (value) {
      const cssVarName = getCSSVarName(key) as keyof CSSProperties;
      (style as any)[cssVarName] = value;
    }
  });

  return style;
}

/**
 * Get CSS variable reference for use in CSS
 * @example
 * useCSSVar('primary') // Returns: 'var(--primary)'
 */
export function useCSSVar(varName: string): string {
  const cssName = varName.startsWith('--') ? varName : getCSSVarName(varName);
  return `var(${cssName})`;
}

/**
 * BRAND color variables
 * Use this to set up brand colors as CSS variables
 */
export const BRAND_COLOR_VARS = {
  primary: BRAND.primary,
  primaryDark: BRAND.primaryDark,
  primaryLight: BRAND.primaryLight,
  brandGreen: BRAND.brandGreen,
  sale: BRAND.sale,
  text: BRAND.text,
  textMuted: BRAND.textMuted,
  border: BRAND.border,
  cartBar: BRAND.cartBar,
} as const;

/**
 * Set vendor-specific color variables
 * @example
 * setVendorColorVars('#009345')
 * // Returns: { '--vendor-primary': '#009345', '--vendor-light': '#00cc4d' }
 */
export function setVendorColorVars(
  primaryColor: string
): CSSProperties {
  return {
    '--vendor-primary': primaryColor,
    '--vendor-dark': `${primaryColor}cc`,
    '--vendor-light': `${primaryColor}15`,
    '--vendor-transparent': `${primaryColor}40`,
  } as any;
}

/**
 * Set status color variables
 * Useful for order status, delivery status, etc.
 */
export function setStatusColorVars(statusColor: string): CSSProperties {
  return {
    '--status-color': statusColor,
    '--status-bg': `${statusColor}15`,
    '--status-border': `${statusColor}40`,
  } as any;
}

/**
 * Set section color variables
 * Useful for dynamic section backgrounds and text colors from API
 */
export function setSectionColorVars(
  backgroundColor?: string,
  textColor?: string,
  headerColor?: string
): CSSProperties {
  return {
    '--section-bg': backgroundColor ?? '#ffffff',
    '--section-text': textColor ?? '#111111',
    '--section-header': headerColor ?? '#111111',
  } as any;
}

/**
 * Combine multiple color variable sets
 * @example
 * combineColorVars(
 *   setCSSVars(BRAND_COLOR_VARS),
 *   setVendorColorVars(vendor.primaryColor),
 *   setStatusColorVars(statusColor)
 * )
 */
export function combineColorVars(
  ...varSets: CSSProperties[]
): CSSProperties {
  return Object.assign({}, ...varSets);
}

/**
 * Helper to create style with CSS variables
 * Maintains fallback hex colors while using variables
 *
 * @example
 * createStyleWithVars({ backgroundColor: '#009345' }, '#009345')
 * // Returns: { backgroundColor: 'var(--primary-color, #009345)' }
 */
export function createStyleWithVars(
  style: Record<string, string>,
  fallbackColor?: string
): CSSProperties {
  const result: CSSProperties = {};

  Object.entries(style).forEach(([key, value]) => {
    // Extract the CSS property name
    const cssKey = key as keyof CSSProperties;

    // Try to find a matching CSS variable
    const varName = getCSSVarName(key);

    // Use variable with fallback
    (result as any)[cssKey] = `var(${varName}, ${value})`;
  });

  return result;
}

/**
 * Create a data attribute for CSS color targeting
 * Useful for Tailwind arbitrary value selection
 *
 * @example
 * <div data-color={createColorDataAttr('#009345')}>
 *   This div has a data attribute with hex color
 * </div>
 */
export function createColorDataAttr(color: string): string {
  // Safely encode hex color for data attribute
  return color.replace('#', '');
}
