import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand green — anchored on the City Markets Saudi
        // identity color (#009345). The 50–900 ramp below replaces
        // ad-hoc `emerald-*` usage across the customer + admin UIs so
        // the two surfaces share a single source of truth. `DEFAULT`,
        // `dark`, and `light` are preserved for callers that use the
        // token-by-name form.
        primary: {
          DEFAULT: "#009345",
          dark: "#007A38",
          light: "#E6F5EC",
          50: "#E6F5EC",
          100: "#C7E8D2",
          200: "#9CD6B2",
          300: "#6BC28F",
          400: "#3DAE6E",
          500: "#1FA058",
          600: "#009345",
          700: "#007A38",
          800: "#005F2B",
          900: "#003F1C",
        },
        // Convenience aliases for admin components using camelCase gradients
        "primary-dark": "#007A38",
        "primary-light": "#E6F5EC",
        secondary: "#1A1A2E",
        accent: "#F59E0B",
        "accent-2": "#10B981",
        // Admin specific colors
        slate: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
      },
      fontFamily: {
        sans: ["var(--font-ibm-plex)", "system-ui", "sans-serif"],
        // Distinct display face for headings (h1/h2) on category landing
        // surfaces so the visual hierarchy doesn't rest entirely on
        // weight/size. Use `className="font-display"` on the heading.
        display: ["var(--font-tajawal)", "var(--font-ibm-plex)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "soft": "0 2px 8px -2px rgba(0, 0, 0, 0.05), 0 4px 16px -4px rgba(0, 0, 0, 0.1)",
        "soft-lg": "0 4px 12px -4px rgba(0, 0, 0, 0.05), 0 8px 24px -8px rgba(0, 0, 0, 0.1)",
      },
      animation: {
        "slide-in": "slideIn 0.3s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        slideIn: {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
