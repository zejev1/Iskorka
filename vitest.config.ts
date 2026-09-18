import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node:test constitution checks run separately via npm run test:profile.
    include: ['tests/**/*.test.ts'],
    // Vitest 3.1.x fork workers can raise a false RPC onTaskUpdate timeout
    // when one CPU-heavy long-run test exceeds ~60 seconds on a busy CI worker.
    // Threads avoid that fork RPC failure without changing simulation logic.
    pool: 'threads',
  },
});
