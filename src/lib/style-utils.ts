/**
 * Utility functions for dynamic style generation
 * Converts brand colors and dynamic values into optimized style objects
 */

interface DynamicColorStyle {
  [key: string]: string | number;
}

/**
 * Generate CSS variable-friendly style object for brand colors
 * Usage: getColorStyle({ background: vendor.primaryColor, color: "white" })
 */
export function getColorStyle(colors: Record<string, string | undefined>): DynamicColorStyle {
  const style: DynamicColorStyle = {};

  Object.entries(colors).forEach(([key, value]) => {
    if (value) {
      style[key] = value;
    }
  });

  return style;
}

/**
 * Generate style for percentage-based layouts
 * Usage: getPercentageStyle('height', 75) → { height: '75%' }
 */
export function getPercentageStyle(
  property: 'width' | 'height' | 'top' | 'left' | 'right' | 'bottom',
  percentage: number
): DynamicColorStyle {
  return {
    [property]: `${Math.min(100, Math.max(0, percentage))}%`,
  };
}

/**
 * Generate style with safe area insets for mobile
 * Usage: getBottomWithSafeArea('4.25rem') → { bottom: 'calc(4.25rem + env(...))' }
 */
export function getBottomWithSafeArea(baseValue: string): DynamicColorStyle {
  return {
    bottom: `calc(${baseValue} + env(safe-area-inset-bottom, 0px))`,
  };
}

/**
 * Generate style for gradient backgrounds using brand color
 * Usage: getGradientStyle(vendor.primaryColor) → { background: 'linear-gradient(...)' }
 */
export function getGradientStyle(brandColor: string, direction = '135deg'): DynamicColorStyle {
  return {
    background: `linear-gradient(${direction}, ${brandColor} 0%, ${brandColor}cc 100%)`,
  };
}

/**
 * Generate style with opacity overlay color
 * Usage: getOverlayColorStyle('#009345', 0.1) → { backgroundColor: 'rgba(..., 0.1)' }
 */
export function getOverlayColorStyle(color: string, opacity: number): DynamicColorStyle {
  // Convert hex to rgba
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${opacity})`,
  };
}

/**
 * Generate safe inline style object (only when necessary)
 * Use this instead of directly creating style={{}} objects
 */
export function createStyle(props: Record<string, string | number | undefined>): React.CSSProperties {
  const style: React.CSSProperties = {};

  Object.entries(props).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      // Convert camelCase to CSS property
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase() as keyof React.CSSProperties;
      style[cssKey] = value as any;
    }
  });

  return style;
}
