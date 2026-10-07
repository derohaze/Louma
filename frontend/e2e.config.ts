import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { openrouter } from '@openrouter/ai-sdk-provider';

export default {
  // OpenRouter serves the model id and reads OPENROUTER_API_KEY (already set in this environment).
  agents: {
    default: {
      model: openrouter('openai/gpt-6-luna-fast'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? 'http://localhost:3000',
      // Let the runner start the Vite dev server (port 3000, see vite.config.ts).
      command: { executable: 'bun', args: ['run', 'dev'], log: '.e2e/logs/app.log', reuseExisting: true },
    },
  }],
} satisfies E2EConfig;
