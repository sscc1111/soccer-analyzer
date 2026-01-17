/**
 * Color contrast utilities for ensuring text visibility on colored backgrounds.
 * Uses WCAG luminance formula to determine optimal text color.
 */

/**
 * Parse a color string (hex or rgb) to RGB values
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  // Handle hex colors
  const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (hexMatch) {
    return {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16),
    };
  }

  // Handle short hex colors (#fff)
  const shortHexMatch = color.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
  if (shortHexMatch) {
    return {
      r: parseInt(shortHexMatch[1] + shortHexMatch[1], 16),
      g: parseInt(shortHexMatch[2] + shortHexMatch[2], 16),
      b: parseInt(shortHexMatch[3] + shortHexMatch[3], 16),
    };
  }

  // Handle rgb/rgba colors
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  return null;
}

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @returns luminance value between 0 (black) and 1 (white)
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Determine if a background color is light or dark
 * @param backgroundColor - The background color in hex or rgb format
 * @returns true if the color is light (should use dark text)
 */
export function isLightColor(backgroundColor: string): boolean {
  const rgb = parseColor(backgroundColor);
  if (!rgb) return false; // Default to dark if parsing fails

  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  // Threshold of 0.5 provides good separation
  // Colors with luminance > 0.5 are considered "light"
  return luminance > 0.5;
}

/**
 * Get the appropriate text color for a given background color
 * @param backgroundColor - The background color in hex or rgb format
 * @param lightText - Color to use on dark backgrounds (default: white)
 * @param darkText - Color to use on light backgrounds (default: black)
 * @returns The appropriate text color
 */
export function getContrastingTextColor(
  backgroundColor: string,
  lightText: string = "#ffffff",
  darkText: string = "#000000"
): string {
  return isLightColor(backgroundColor) ? darkText : lightText;
}

/**
 * Get text color with optional shadow for better visibility
 * Returns both color and textShadow style properties
 */
export function getContrastingTextStyle(
  backgroundColor: string
): { color: string; textShadowColor?: string; textShadowOffset?: { width: number; height: number }; textShadowRadius?: number } {
  const isLight = isLightColor(backgroundColor);

  if (isLight) {
    return {
      color: "#000000",
      textShadowColor: "rgba(255, 255, 255, 0.5)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 2,
    };
  } else {
    return {
      color: "#ffffff",
      textShadowColor: "rgba(0, 0, 0, 0.5)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 2,
    };
  }
}
