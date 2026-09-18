const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export async function fetchApi<T = any>(
  endpoint: string,
  options: RequestInit & { studioId?: string } = {},
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pilates_token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.studioId) {
    headers['x-studio-id'] = options.studioId;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMessage = 'Bir hata oluştu';
    try {
      const errorData = await res.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      errorMessage = `HTTP Hatası: ${res.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return res.json();
}
