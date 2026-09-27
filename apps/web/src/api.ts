import type { QrPayload } from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const candidate = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      if (typeof candidate[key] === 'string' && candidate[key]) return candidate[key];
    }
  }
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Não foi possível alcançar o servidor.', 0);
  }

  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown = null;
  if (response.status !== 204) {
    try {
      body = contentType.includes('json') ? await response.json() : await response.text();
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(messageFromBody(body, `A solicitação falhou (${response.status}).`), response.status);
  }
  return body as T;
}

function normalizeQr(value: string): string {
  if (value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('http')) return value;
  return `data:image/png;base64,${value}`;
}

export function qrFromPayload(payload: QrPayload): { image: string | null; meta: QrPayload } {
  const raw = payload.qrCode ?? payload.qrcode ?? payload.base64 ?? null;
  return { image: raw ? normalizeQr(raw) : null, meta: payload };
}

export async function fetchQr(): Promise<{ image: string | null; meta: QrPayload }> {
  let response: Response;
  try {
    response = await fetch('/api/evolution/qr', { credentials: 'same-origin' });
  } catch {
    throw new ApiError('Não foi possível buscar o QR Code.', 0);
  }
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(messageFromBody(body, 'Não foi possível gerar o QR Code.'), response.status);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    return { image: URL.createObjectURL(blob), meta: {} };
  }

  const payload = (await response.json()) as QrPayload;
  return qrFromPayload(payload);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Algo deu errado. Tente novamente.';
}
