// Demo scenario for pw-video run: drives the PoC task-board app through a
// behavioral arc (typing, clicks, progress animation, theme toggle, hover).
// Usage: node scripts/pw-video.mjs run examples/demo-scenario.mjs --out <dir>
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const demoUrl = 'file://' + join(repoRoot, '.playwright-mcp', 'video-poc', 'demo-app.html');

export default async function scenario({ page, step }) {
  await page.goto(demoUrl);
  await page.waitForSelector('#add-btn');
  await step('ШАГ 1: страница загружена');
  await page.waitForTimeout(1200);

  await step('ШАГ 2: вводим задачу «Оплатить хостинг»');
  await page.click('#task-input');
  await page.type('#task-input', 'Оплатить хостинг', { delay: 55 });

  await step('ШАГ 3: клик «Добавить» → прогресс → задача в списке');
  await page.click('#add-btn');
  await page.waitForSelector('#tasks li');
  await page.waitForTimeout(600);

  await step('ШАГ 4: вводим «Проверить бэкапы»');
  await page.click('#task-input');
  await page.type('#task-input', 'Проверить бэкапы', { delay: 55 });

  await step('ШАГ 5: клик «Добавить» №2');
  await page.click('#add-btn');
  await page.waitForFunction(() => document.querySelectorAll('#tasks li').length >= 2);
  await page.waitForTimeout(500);

  await step('ШАГ 6: переключаем тёмную тему');
  await page.click('#theme-switch');
  await page.waitForTimeout(800);

  await step('ШАГ 7: hover по первой задаче');
  await page.hover('#tasks li:first-child');
  await page.waitForTimeout(700);

  await step('ЗАПИСЬ ЗАВЕРШЕНА');
  await page.waitForTimeout(1500);
}
