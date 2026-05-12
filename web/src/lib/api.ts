const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}
