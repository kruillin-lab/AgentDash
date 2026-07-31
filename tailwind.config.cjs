/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: "#04060d",
          900: "#070a16",
          800: "#0b1022",
          700: "#121833",
        },
        neon: {
          cyan: "#22e3ff",
          magenta: "#ff44d8",
          violet: "#a78bfa",
          lime: "#9dff5b",
          amber: "#ffb454",
          rose: "#ff6b8b",
        },
        glass: {
          DEFAULT: "rgba(18,24,51,0.55)",
          strong: "rgba(18,24,51,0.75)",
          edge: "rgba(120,160,255,0.18)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "Helvetica", "Arial"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(120,160,255,0.18), 0 8px 40px -8px rgba(34,227,255,0.35)",
        "neon-strong": "0 0 0 1px rgba(34,227,255,0.5), 0 0 30px -4px rgba(34,227,255,0.6)",
        glass: "0 8px 32px -4px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      backgroundImage: {
        "radial-fade": "radial-gradient(circle at 50% 0%, rgba(34,227,255,0.18), transparent 60%)",
        "grid-faint":
          "linear-gradient(rgba(120,160,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,160,255,0.05) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
      keyframes: {
        auroraShift: {
          "0%, 100%": { transform: "translate3d(-6%, -4%, 0) scale(1.1)" },
          "50%": { transform: "translate3d(6%, 4%, 0) scale(1.25)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.55", filter: "blur(60px)" },
          "50%": { opacity: "0.85", filter: "blur(48px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        ticker: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        aurora: "auroraShift 18s ease-in-out infinite",
        pulseGlow: "pulseGlow 6s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        scanline: "scanline 7s linear infinite",
        ticker: "ticker 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
}