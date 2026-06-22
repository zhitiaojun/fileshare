import type { APIResponse } from '../types';

export function success<T>(detail?: T, message = 'ok'): APIResponse<T> {
  return {
    code: 200,
    message,
    msg: message,
    detail,
  };
}

export function error(code: number, message: string): APIResponse<null> {
  return {
    code,
    message,
    msg: message,
    detail: null,
  };
}

export function jsonSuccess<T>(detail?: T, message = 'ok'): Response {
  return Response.json(success(detail, message));
}

export function jsonError(code: number, message: string, status?: number): Response {
  return Response.json(error(code, message), { status: status || code });
}
