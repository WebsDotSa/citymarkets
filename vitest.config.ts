import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Switch to jsdom for .tsx files that render React components.
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/components/**", "src/app/api/**"],
      // route.test.ts files are regression guards — their lines must run
      // to exercise the route, but counting them toward the route's own
      // coverage would inflate the numbers. Excluded from coverage scope.
      exclude: ["**/*.test.*", "**/types.ts", "**/*.d.ts"],
      // Per-directory thresholds target src/lib/ where most refactor work
      // happens. Components and API routes are bonus; we only require
      // src/lib/ to clear 80% so a single stubborn component can never
      // fail the whole suite.
      thresholds: {
        "src/lib/**": {
          lines: 80,
          functions: 85,
          statements: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
