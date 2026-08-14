// Unit tests for the LoginPage component.
// The page renders a login form (username + password inputs + submit button)
// and calls useAuth().login() on submit. We verify:
//   - the form renders with username and password inputs and a submit button
//   - the submit button is disabled until both fields are filled (if applicable)
//   - submitting with credentials calls the login function
// We mock the auth context's `login` so no real API call is made, and wrap
// the page in the providers it needs (AuthProvider, LanguageProvider,
// MemoryRouter for useNavigate).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { LanguageProvider } from '../i18n/LanguageContext';
import LoginPage from '../pages/LoginPage';

// Mock the api module so AuthProvider's login() doesn't make a real request.
// We only need api.login (used by LoginPage) and api.getMe (used by AuthProvider
// on mount). Both return a non-200 so the provider stays in the logged-out
// state without trying to read a token from localStorage.
vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    getMe: vi.fn().mockResolvedValue({ code: 401 }),
  },
  setToken: vi.fn(),
}));

// Clear localStorage and mock calls between tests so each starts clean.
beforeEach(() => {
  localStorage.clear();
});

// Helper: render LoginPage wrapped in all the providers it needs.
// `loginImpl` is the function the mocked auth context will use as `login`.
function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  it('renders a username input', () => {
    renderPage();
    // The input is type="text" with a placeholder (i18n key login.username).
    // We look it up by type to avoid depending on the i18n string.
    const usernameInput = document.querySelector('input[type="text"]');
    expect(usernameInput).toBeInTheDocument();
  });

  it('renders a password input', () => {
    renderPage();
    const passwordInput = document.querySelector('input[type="password"]');
    expect(passwordInput).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    renderPage();
    // The submit button is <button type="submit">. We grab all buttons and
    // find the submit one (LanguageSwitcher renders its own button, type="button").
    const submitButtons = screen.getAllByRole('button').filter(
      (b) => b.getAttribute('type') === 'submit'
    );
    expect(submitButtons.length).toBe(1);
    expect(submitButtons[0]).toBeInTheDocument();
  });

  it('does not render any quick-login button', () => {
    // Sanity check tied to the Day-1 security task: no shortcut buttons that
    // would log the user in as admin/player in one click. The only buttons
    // present should be the form submit button and the LanguageSwitcher toggle.
    renderPage();
    const allButtons = screen.getAllByRole('button');
    // Submit + language switcher = 2 buttons, no more.
    expect(allButtons.length).toBe(2);
    for (const b of allButtons) {
      const label = b.textContent.toLowerCase();
      expect(label).not.toMatch(/admin|player|judge|quick|demo/);
    }
  });

  it('lets the user type into both inputs', () => {
    renderPage();
    const usernameInput = document.querySelector('input[type="text"]');
    const passwordInput = document.querySelector('input[type="password"]');
    fireEvent.change(usernameInput, { target: { value: 'alice' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    expect(usernameInput.value).toBe('alice');
    expect(passwordInput.value).toBe('secret');
  });

  it('calls login() with the typed credentials when the form is submitted', async () => {
    // We import the mocked api so we can spy on api.login directly.
    const { api } = await import('../api');
    api.login.mockResolvedValueOnce({ code: 200, data: { token: 'tok', user: { id: 1, username: 'alice', role: 'ORG_ADMIN' } } });

    renderPage();
    const usernameInput = document.querySelector('input[type="text"]');
    const passwordInput = document.querySelector('input[type="password"]');
    const submitButton = screen.getAllByRole('button').find(
      (b) => b.getAttribute('type') === 'submit'
    );

    fireEvent.change(usernameInput, { target: { value: 'alice' } });
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    fireEvent.click(submitButton);

    // Wait a tick for the async login to fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(api.login).toHaveBeenCalledWith('alice', 'secret');
  });
});
