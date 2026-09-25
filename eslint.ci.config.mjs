import config from './eslint.config.mjs';

export default [
  ...config,
  {
    // These extensions are checked by format:check in the required Code quality job.
    // Keep formatting enabled for other ESLint inputs, including .mts and .cts.
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: { 'prettier/prettier': 'off' },
  },
];
