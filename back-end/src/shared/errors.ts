export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = () => new AppError(401, "unauthorized", "Sign in to continue.");
export const forbidden = (code = "forbidden", message = "This action is not allowed.") =>
  new AppError(403, code, message);
export const notFound = () => new AppError(404, "not_found", "The requested resource was not found.");
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);
export const tooManyAttempts = () => new AppError(429, "rate_limited", "Too many attempts. Try again later.");
