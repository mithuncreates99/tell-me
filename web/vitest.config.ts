import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Dates are local-time based; pin a zone with DST so tests are deterministic anywhere.
    env: { TZ: 'Europe/Paris' },
  },
});
