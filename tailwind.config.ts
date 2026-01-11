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
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        ring: "var(--ring)",
        org: {
          primary: "var(--color-org-primary)",
          "primary-light": "var(--color-org-primary-light)",
          "primary-dark": "var(--color-org-primary-dark)",
          secondary: "var(--color-org-secondary)",
          "secondary-light": "var(--color-org-secondary-light)",
          "secondary-dark": "var(--color-org-secondary-dark)",
          "secondary-foreground": "var(--color-org-secondary-foreground)",
        },
        landing: {
          navy: "rgb(var(--landing-navy-rgb) / <alpha-value>)",
          "navy-light": "rgb(var(--landing-navy-light-rgb) / <alpha-value>)",
          cream: "rgb(var(--landing-cream-rgb) / <alpha-value>)",
          "cream-muted": "rgb(var(--landing-cream-muted-rgb) / <alpha-value>)",
          green: "rgb(var(--landing-green-rgb) / <alpha-value>)",
          "green-dark": "rgb(var(--landing-green-dark-rgb) / <alpha-value>)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        info: "var(--info)",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        display: ["Bitter", "Georgia", "serif"],
        mono: ["Space Mono", "monospace"],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        soft: "0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)",
      },
    },
  },
  plugins: [],
};
export default config;
