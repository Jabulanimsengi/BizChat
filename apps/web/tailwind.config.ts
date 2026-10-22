import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#12211b',
        moss: '#155f43',
        mint: '#dff7ea',
        cream: '#f7f5ef',
        line: '#dce4de',
      },
      boxShadow: { panel: '0 24px 80px rgba(18, 33, 27, 0.10)' },
    },
  },
  plugins: [],
} satisfies Config;
