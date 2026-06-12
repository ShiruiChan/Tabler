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
        // Platform-level design tokens (globals.css)
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Per-tenant theme tokens set by buildThemeStyle() on the wrapper div.
        // Tailwind generates bg-primary, text-primary, border-primary, etc.
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        accent: "var(--color-accent)",
      },
      fontFamily: {
        // Per-tenant font stacks set by buildThemeStyle() on the wrapper div.
        // Tailwind generates font-heading, font-body classes.
        heading: "var(--font-heading)",
        body: "var(--font-body)",
      },
    },
  },
  plugins: [],
};
export default config;
