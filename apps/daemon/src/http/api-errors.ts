import type { ApiError, ApiErrorCode, ApiErrorResponse } from '@openpixo/contracts';
import type { Response } from 'express';

import { recordApiFailure } from './api-failure-journal.js';

export function createCompatApiError(
  code: ApiErrorCode,
  message: string,
  init: Omit<ApiError, 'code' | 'message'> = {},
): ApiError {
  return { code, message, ...init };
}

export function createCompatApiErrorResponse(
  code: ApiErrorCode,
  message: string,
  init: Omit<ApiError, 'code' | 'message'> = {},
): ApiErrorResponse {
  return { error: createCompatApiError(code, message, init) };
}

/**
 * The text of a caught error, fit for an API error body. A filesystem error's
 * own message names the absolute path it failed on, which only exposes how the
 * user's disk is laid out, so the reader gets what went wrong instead.
 */
export function publicErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { code, path } = error as NodeJS.ErrnoException;
  if (typeof path !== 'string') return error.message;
  return code === 'ENOENT' ? 'File or folder not found' : `File or folder unavailable (${code ?? 'unknown error'})`;
}

export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  init: Omit<ApiError, 'code' | 'message'> = {},
): Response<ApiErrorResponse> {
  const request = res.req;
  recordApiFailure({
    at: new Date().toISOString(),
    request,
    status,
    code,
    retryable: init.retryable === true,
    ...(init.requestId ? { requestId: init.requestId } : {}),
  });
  return res
    .status(status)
    .json(createCompatApiErrorResponse(code, message, init));
}
