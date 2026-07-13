import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark mode driven by data-theme="dark" on <html> (matches original CSS)
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // All themed colors map to CSS custom properties set in globals.css
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        surface: 'var(--surface)',
        'surface-soft': 'var(--surface-soft)',
        section: 'var(--section)',
        field: 'var(--field)',
        text: {
          DEFAULT: 'var(--text)',
          dim: 'var(--text-dim)',
          faint: 'var(--text-faint)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          on: 'var(--on-primary)',
          soft: 'var(--primary-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
        success: {
          DEFAULT: 'var(--success)',
          soft: 'var(--success-soft)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          soft: 'var(--warning-soft)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        header: 'var(--header)',
        scrim: 'var(--scrim)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: {
        card: 'var(--shadow)',
        'card-lg': 'var(--shadow-lg)',
      },
      animation: {
        'fade-up': 'fadeUp 0.4s cubic-bezier(.16,1,.3,1) both',
        'menu-in': 'menuIn 0.2s cubic-bezier(.16,1,.3,1)',
        'modal-in': 'modalIn 0.32s cubic-bezier(.34,1.4,.64,1)',
        'scrim-in': 'scrimIn 0.2s cubic-bezier(.16,1,.3,1)',
        'spring-in': 'springIn 0.28s cubic-bezier(.34,1.4,.64,1)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        menuIn: {
          from: { opacity: '0', transform: 'translateY(-7px) scale(0.96)' },
          to: { opacity: '1', transform: 'none' },
        },
        modalIn: {
          from: { opacity: '0', transform: 'translateY(22px) scale(0.97)' },
          to: { opacity: '1', transform: 'none' },
        },
        scrimIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        springIn: {
          from: { opacity: '0', transform: 'scale(0.92)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      transitionTimingFunction: {
        'ease-out-custom': 'cubic-bezier(.16,1,.3,1)',
        spring: 'cubic-bezier(.34,1.4,.64,1)',
      },
      zIndex: {
        60: '60',
        70: '70',
        80: '80',
        90: '90',
        100: '100',
      },
    },
  },
  plugins: [],
} satisfies Config
