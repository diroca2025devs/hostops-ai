/** Erro de aplicação com status HTTP e código estável para o cliente. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Autenticação necessária.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Você não tem permissão para esta operação.') => new AppError(403, 'FORBIDDEN', message);
/**
 * Recursos de outra organização respondem 404 (e não 403) para não revelar que existem.
 */
export const notFound = (what = 'Recurso') => new AppError(404, 'NOT_FOUND', `${what} não encontrado(a).`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new AppError(409, code, message, details);
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, code, message, details);

/** Violação de índice único do Prisma (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
