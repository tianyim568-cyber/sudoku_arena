// Unit tests for the LanguageSwitcher component.
// The component renders a single button that toggles the language between
// 'zh' and 'en' via useLanguage(). We verify:
//   - it renders a button
//   - the button label reflects the NEXT language (zh -> shows "EN")
//   - clicking the button actually changes the language (zh -> en)
// Because the component uses useLanguage(), we must wrap it in the
// LanguageProvider so the context is non-null.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

// Helper: render the switcher inside its provider. The provider reads
// localStorage on mount, so we clear it before each test to start from the
// default ('zh').
function renderSwitcher() {
  localStorage.clear();
  return render(
    <LanguageProvider>
      <LanguageSwitcher />
    </LanguageProvider>
  );
}

describe('LanguageSwitcher', () => {
  it('renders a button', () => {
    renderSwitcher();
    // The component renders one <button type="button"> with an aria-label.
    const button = screen.getByRole('button', { name: /switch language/i });
    expect(button).toBeInTheDocument();
  });

  it('shows "EN" when the current language is zh (default)', () => {
    renderSwitcher();
    // Default language is 'zh' (see LanguageContext). The button label is the
    // language we WILL switch to, so it should display "EN".
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('changes the label to "中文" after a click (language is now en)', () => {
    renderSwitcher();
    const button = screen.getByRole('button', { name: /switch language/i });
    fireEvent.click(button);
    // After the click, lang === 'en', so the button offers to switch back to zh.
    expect(screen.getByText('中文')).toBeInTheDocument();
  });

  it('toggles back to "EN" after two clicks', () => {
    renderSwitcher();
    const button = screen.getByRole('button', { name: /switch language/i });
    fireEvent.click(button); // zh -> en
    expect(screen.getByText('中文')).toBeInTheDocument();
    fireEvent.click(button); // en -> zh
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('persists the chosen language to localStorage', () => {
    renderSwitcher();
    const button = screen.getByRole('button', { name: /switch language/i });
    fireEvent.click(button); // zh -> en
    // The provider writes the language under the 'sa_lang' key.
    expect(localStorage.getItem('sa_lang')).toBe('en');
  });
});
