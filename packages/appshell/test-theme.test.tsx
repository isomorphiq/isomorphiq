import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from '../src/components/ThemeProvider.tsx';
import { ThemeToggle } from '../src/components/ThemeToggle.tsx';

// Test component to use the theme hook
function TestComponent() {
  const { theme, effectiveTheme, setTheme, isDark, isLight } = useTheme();
  
  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="effective-theme">{effectiveTheme}</div>
      <div data-testid="is-dark">{isDark.toString()}</div>
      <div data-testid="is-light">{isLight.toString()}</div>
      <button onClick={() => setTheme('dark')} data-testid="set-dark">Set Dark</button>
      <button onClick={() => setTheme('light')} data-testid="set-light">Set Light</button>
      <button onClick={() => setTheme('system')} data-testid="set-system">Set System</button>
    </div>
  );
}

describe('Theme System', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(), // deprecated
        removeListener: jest.fn(), // deprecated
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  it('should initialize with system theme by default', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('effective-theme')).toHaveTextContent('light'); // system default to light in mock
    expect(screen.getByTestId('is-light')).toHaveTextContent('true');
  });

  it('should switch to dark theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId('set-dark'));
    
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('effective-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('true');
  });

  it('should switch to light theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId('set-light'));
    
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('effective-theme')).toHaveTextContent('light');
    expect(screen.getByTestId('is-light')).toHaveTextContent('true');
  });

  it('should persist theme preference to localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId('set-dark'));
    
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('should load theme from localStorage on initialization', () => {
    localStorage.setItem('theme', 'light');
    
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('effective-theme')).toHaveTextContent('light');
  });
});

describe('ThemeToggle', () => {
  it('should render theme toggle button', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggle = screen.getByRole('button');
    expect(toggle).toBeInTheDocument();
  });

  it('should cycle through themes when clicked', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    const toggle = screen.getByRole('button');
    
    // Initial state should be system
    fireEvent.click(toggle);
    // Should switch to light
    fireEvent.click(toggle);
    // Should switch to dark
    fireEvent.click(toggle);
    // Should switch back to system
    
    // Verify the theme changed by checking if localStorage was updated
    expect(localStorage.getItem('theme')).toBe('system');
  });
});