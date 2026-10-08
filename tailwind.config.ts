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
        // Unified gray scale (replaces scattered hex colors)
        gray: {
          50: "#F9FAFB",
          100: "#F3F4F6",
          200: "#E5E7EB",
          300: "#D1D5DB",
          400: "#9CA3AF",
          500: "#6B7280",
          600: "#4B5563",
          700: "#374151",
          800: "#1F2937",
          900: "#111827",
        },
      },
      fontFamily: {
        sans: ["var(--font-ibm-plex)", "system-ui", "sans-serif"],
        // Distinct display face for headings (h1/h2) on category landing
        // surfaces so the visual hierarchy doesn't rest entirely on
        // weight/size. Use `className="font-display"` on the heading.
        display: ["var(--font-tajawal)", "var(--font-ibm-plex)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Custom sizes for 10px and 11px that replaced 208 inline text-[10px]/text-[11px] usages
        tiny: ["0.625rem", { lineHeight: "0.875rem" }],   // 10px
        "2xs": ["0.6875rem", { lineHeight: "0.875rem" }], // 11px
        // Additional sizes for badge and label components
        "3xs": ["0.5625rem", { lineHeight: "0.75rem" }],  // 9px
        // Unified typography scale
        h1: ["2.25rem", { lineHeight: "2.5rem", fontWeight: "700" }],     // 36px
        h2: ["1.875rem", { lineHeight: "2.25rem", fontWeight: "700" }],   // 30px
        h3: ["1.5rem", { lineHeight: "2rem", fontWeight: "600" }],        // 24px
        h4: ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }],    // 20px
        h5: ["1rem", { lineHeight: "1.5rem", fontWeight: "600" }],        // 16px
        h6: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "600" }],   // 14px
        body: ["1rem", { lineHeight: "1.5rem" }],                          // 16px
        "body-sm": ["0.875rem", { lineHeight: "1.25rem" }],               // 14px
        "body-xs": ["0.75rem", { lineHeight: "1rem" }],                   // 12px
        caption: ["0.625rem", { lineHeight: "0.875rem" }],                // 10px
      },
      spacing: {
        // Header and sticky positioning tokens
        "header": "64px",        // Header V2 height (mobile)
        "header-sm": "80px",     // Header V2 height on sm+ breakpoint
        "breadcrumb": "40px",    // Breadcrumb bar height
        "header-breadcrumb": "104px", // Header + breadcrumb (64 + 40)
        "header-sm-breadcrumb": "120px", // Header + breadcrumb on sm+ (80 + 40)
        // Container sizes
        "container-sm": "24rem",    // 384px (small modals, sidebars)
        "container-md": "32rem",    // 512px (medium modals)
        "container-lg": "48rem",    // 768px (large modals)
        "container-xl": "64rem",    // 1024px (wide content)
        "container-2xl": "80rem",   // 1280px (page width)
      },
      borderRadius: {
        // Unified border radius scale
        none: "0px",
        xs: "0.25rem",   // 4px - very small
        sm: "0.375rem",  // 6px - small (inputs, badges)
        md: "0.5rem",    // 8px - medium
        lg: "0.75rem",   // 12px - cards, sections
        xl: "1rem",      // 16px - dialogs, modals
        "2xl": "1.5rem", // 24px - large surfaces (buttons, featured cards)
        "3xl": "2rem",   // 32px - very large (hero cards)
        full: "9999px",  // full circle (pills, avatars)
      },
      boxShadow: {
        // Unified shadow system (elevation hierarchy)
        xs: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05), 0 1px 3px 0 rgba(0, 0, 0, 0.1)",
        md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        "2xl": "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
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
