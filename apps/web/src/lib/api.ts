/** Cliente HTTP do painel. Sempre mesma origem (/api/v1 → rewrite do Next → API Fastify). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* resposta não-JSON */
  }
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (response.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('hostops:unauthorized'));
    }
    throw new ApiError(response.status, error?.code ?? 'ERROR', error?.message ?? `Erro ${response.status}`, error?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
      return (error.details as Array<{ path: string; message: string }>).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(' · ');
    }
    if (error.code === 'CHECKLIST_INCOMPLETE') {
      const blockers = (error.details as { blockers?: string[] } | undefined)?.blockers ?? [];
      return `${error.message} ${blockers.join(' · ')}`;
    }
    return error.message;
  }
  return 'Erro inesperado.';
}
