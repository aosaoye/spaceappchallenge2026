const BACKEND_STORAGE_KEY = "spherex-backend-url";

function normalizeOriginUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    // ignorar URL no válida
  }
  return "";
}

export function getBasePath(): string {
  return (process.env.NEXT_PUBLIC_BASE_PATH || "").trim().replace(/\/+$/, "");
}

export function withBasePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const base = getBasePath();
  if (!base || path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const qsBackend = new URLSearchParams(window.location.search).get("backend");
    if (qsBackend) {
      const cleanQs = normalizeOriginUrl(qsBackend);
      if (cleanQs) {
        try {
          window.localStorage.setItem(BACKEND_STORAGE_KEY, cleanQs);
        } catch {
          // ignorar si localStorage no está disponible
        }
        return cleanQs;
      }
    }

    try {
      const saved = window.localStorage.getItem(BACKEND_STORAGE_KEY);
      if (saved) {
        const cleanSaved = normalizeOriginUrl(saved);
        if (cleanSaved) return cleanSaved;
      }
    } catch {
      // ignorar si localStorage no está disponible
    }
  }

  return normalizeOriginUrl(process.env.NEXT_PUBLIC_API_URL || "");
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalized}` : normalized;
}
