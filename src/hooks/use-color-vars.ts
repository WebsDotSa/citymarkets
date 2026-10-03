'use client';

import { useMemo } from 'react';
import {
  setCSSVars,
  setVendorColorVars,
  setStatusColorVars,
  combineColorVars,
  BRAND_COLOR_VARS,
  type React,
} from '@/lib/color-variables';

/**
 * Hook for managing brand color variables
 * Returns a style object with CSS variables set
 */
export function useBrandColorVars(): React.CSSProperties {
  return useMemo(() => setCSSVars(BRAND_COLOR_VARS), []);
}

/**
 * Hook for vendor-specific color variables
 * Generates light/dark/transparent variants from primary color
 */
export function useVendorColorVars(
  primaryColor?: string
): React.CSSProperties {
  return useMemo(() => {
    if (!primaryColor) return {};
    return setVendorColorVars(primaryColor);
  }, [primaryColor]);
}

/**
 * Hook for status color variables
 * Generates background and border variants from status color
 */
export function useStatusColorVars(
  statusColor?: string
): React.CSSProperties {
  return useMemo(() => {
    if (!statusColor) return {};
    return setStatusColorVars(statusColor);
  }, [statusColor]);
}

/**
 * Combined hook for all color variables
 * Useful when you need brand + vendor + status colors
 */
export function useAllColorVars(
  vendorPrimaryColor?: string,
  statusColor?: string
): React.CSSProperties {
  return useMemo(() => {
    return combineColorVars(
      useBrandColorVars(),
      setVendorColorVars(vendorPrimaryColor || '#009345'),
      setStatusColorVars(statusColor || '#666666')
    );
  }, [vendorPrimaryColor, statusColor]);
}

/**
 * Hook to get a single CSS variable reference
 * Returns the variable name ready for use in CSS
 */
export function useCSSVarRef(varName: string): string {
  return useMemo(() => {
    const cssName = varName.startsWith('--') ? varName : `--${varName}`;
    return `var(${cssName})`;
  }, [varName]);
}
