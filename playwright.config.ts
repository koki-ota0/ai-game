import { defineConfig } from '@playwright/test';
import chromiumBin, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import path from 'node:path';

// The npm-packaged Chromium keeps browser tests runnable in the sandbox without
// downloading binaries from an external CDN. Regular Playwright installations
// can still override this with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
await inflate(path.resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
setupLambdaEnvironment('/tmp/al2023/lib');
chromiumBin.setGraphicsMode = false;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? await chromiumBin.executablePath();
const args = chromiumBin.args.filter(arg => arg !== '--single-process' && arg !== '--in-process-gpu');

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    headless: true,
    launchOptions: { executablePath, args },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
