import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';

const FRONTEND = 'https://barberias-platform.vercel.app';
const BACKEND = 'https://barberias-api-p3br.onrender.com';
const REPORT = 'e2e-live-report.json';
const SHOT_LOAD = 'e2e-load.png';
const SHOT_LOGIN = 'e2e-login.png';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const issues: { section: string; title: string; detail: string }[] = [];
  const backendHits: { url: string; method: string; status: number; ok: boolean }[] = [];

  page.on('response', res => {
    const u = res.url();
    if (!u.startsWith(BACKEND)) return;
    backendHits.push({ url: u, method: res.request().method(), status: res.status(), ok: res.ok() });
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      issues.push({ section: 'console.error', title: 'JS error en consola', detail: `${page.url()} :: ${msg.text().slice(0, 800)}` });
    }
  });

  try {
    await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: SHOT_LOAD, fullPage: true }).catch(() => {});

    await page.goto(`${FRONTEND}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);

    const email = page.locator('input[type="email"], input[name="email"], input[name="correo"], input[name="usuario"], input[name="username"]').first();
    const pass = page.locator('input[type="password"]').first();
    await email.fill('qa-fake-login@qa.local');
    await pass.fill('wrongpass1!');
    const btn = page.locator('button:has-text("Iniciar Sesión")').first();
    if (await btn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(12_000);
    } else {
      issues.push({ section: 'auth', title: 'No se encontró botón de login', detail: '/auth/login no mostró "Iniciar Sesión" visible.' });
    }

    await page.screenshot({ path: SHOT_LOGIN, fullPage: true }).catch(() => {});

    let bodyText = '';
    try { bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400)); } catch {}

    if (backendHits.length === 0) {
      issues.push({
        section: 'network.backend',
        title: 'Sin comunicación detectada con el backend',
        detail: `No se observaron respuestas desde ${BACKEND}. Posibles causas: backend offline/sleeping, CORS bloqueado, ruta anti-crawl, o que el frontend no emite peticiones en la navegación headless.`,
      });
    } else {
      const failed = backendHits.filter(h => !h.ok);
      if (failed.length) {
        issues.push({
          section: 'network.backend',
          title: 'Backend respondió con estado no-OK',
          detail: failed.map(h => `${h.method} ${h.url} → ${h.status}`).join('\n'),
        });
      }
    }

    const loginErrorVisible =
      bodyText.toLowerCase().includes('credencial') ||
      bodyText.toLowerCase().includes('inválida') ||
      bodyText.toLowerCase().includes('clave') ||
      bodyText.toLowerCase().includes('contraseña') ||
      bodyText.toLowerCase().includes('invalid') ||
      bodyText.includes('401') ||
      bodyText.includes('Unauthorized');

    if (!loginErrorVisible) {
      const alreadyReported = issues.some(i => i.section === 'auth' && i.title.includes('No se encontró'));
      if (!alreadyReported) {
        issues.push({
          section: 'auth',
          title: 'Login fallido no mostró mensaje de error visible',
          detail: `Credenciales: qa-fake-login@qa.local / wrongpass1! — texto visible post-envío: ${bodyText.replace(/\s+/g, ' ').trim().slice(0, 300)}`,
        });
      }
    }

    const consoleErrors = issues.filter(i => i.section === 'console.error');
    issues.push({
      section: 'console.summary',
      title: 'Resumen errores JS de consola',
      detail: consoleErrors.length ? consoleErrors.map(i => i.detail).join('\n') : 'Sin errores de consola observados durante la sesión.',
    });

    const report = {
      generatedAt: new Date().toISOString(),
      frontend: FRONTEND,
      backend: BACKEND,
      screenshots: { load: SHOT_LOAD, login: SHOT_LOGIN },
      network: { backendCalls: backendHits.length, failedBackendCalls: backendHits.filter(h => !h.ok).length },
      issues,
    };

    writeFileSync(REPORT, JSON.stringify(report, null, 2));
    console.log('E2E report written to', REPORT);
    console.log('Issues:', issues.length);
    issues.forEach(i => console.log(`[${i.section}] ${i.title}`));
    console.log('Backend calls:', backendHits.length, '| failed:', backendHits.filter(h => !h.ok).length);

    const critical = issues.some(i => ['network.backend', 'auth', 'console.error'].includes(i.section));
    process.exit(critical ? 2 : 0);
  } catch (err) {
    writeFileSync(REPORT, JSON.stringify({ error: String(err) }, null, 2));
    console.error('E2E crashed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
