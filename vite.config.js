import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the build works at https://USER.github.io/ANY-REPO/ without knowing the repo name.
  base: './',
  test: {
    include: ['tests/**/*.test.js'],
  },
});
