import { useEffect } from "react";

const PREFIX = "apivoy:workbench-draft:";

export function readWorkbenchDraft<T>(protocol: string): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${protocol}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; value?: T };
    return parsed.version === 1 && parsed.value ? parsed.value : null;
  } catch {
    localStorage.removeItem(`${PREFIX}${protocol}`);
    return null;
  }
}

export function clearWorkbenchDraft(protocol: string): void {
  try { localStorage.removeItem(`${PREFIX}${protocol}`); } catch { /* storage can be unavailable */ }
}

export function useAutosaveDraft<T>(protocol: string, value: () => T, delayMs = 400): void {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`${PREFIX}${protocol}`, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), value: value() }));
      } catch { /* invalid in-progress JSON or unavailable storage is non-fatal */ }
    }, delayMs);
    return () => window.clearTimeout(timer);
  });
}
