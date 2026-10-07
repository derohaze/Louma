import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('a visitor finds signup from the login page', async ({ app, screen, browser }) => {
  await app.open('/login');
  await expect(screen.getByRole('heading', 'Welcome back')).toBeVisible();
  await expect(screen.getByRole('textbox', 'Email')).toBeVisible();
  await expect(screen.getByLabel('Password')).toBeVisible();
  await expect(screen.getByRole('button', 'Log in')).toBeVisible();

  await screen.getByRole('link', 'Create account').tap();

  await expect(screen.getByRole('heading', 'Start your wallet journey')).toBeVisible();
  await expect(browser).toHaveURL('/signup');
});
