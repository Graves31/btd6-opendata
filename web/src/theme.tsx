// Light / dark mode. Until the visitor picks one, the site follows the device (prefers-color-scheme); a pick is
// kept in localStorage and applied by index.html's inline script before the first paint (no flash).

import { useEffect, useState } from "preact/hooks";

type Theme = "light" | "dark";
const KEY = "theme";
const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

function chosen(): Theme | null {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : null;
}
const current = (): Theme => chosen() ?? (mq?.matches ? "light" : "dark");

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);
  // Following the device: track it when it changes (e.g. the OS switches at sunset).
  useEffect(() => {
    if (!mq) return;
    const on = () => setTheme(current());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      class="theme-btn"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // private mode / blocked storage: the switch still holds for this visit
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? (
        // sun: the way to light mode
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      ) : (
        // moon: the way to dark mode
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
          <path d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a8.5 8.5 0 1 0 10.8 10.8Z" />
        </svg>
      )}
    </button>
  );
}
