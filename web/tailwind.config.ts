import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f5f3ff",
          500: "#6d28d9",
          600: "#5b21b6",
          700: "#4c1d95",
        },
      },
    },
  },
  plugins: [],
};
export default config;
