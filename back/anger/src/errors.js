export class ApiError extends Error {
  constructor(status, code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new ApiError(400, code, message);
export const unauthorized = (code, message) => new ApiError(401, code, message);
export const conflict = (code, message) => new ApiError(409, code, message);
export const tooManyRequests = (code, message) => new ApiError(429, code, message);
export const unavailable = (code, message, cause) => new ApiError(503, code, message, cause);
