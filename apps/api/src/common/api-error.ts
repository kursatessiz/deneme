import { HttpException } from '@nestjs/common';
import { apiErrorBaseMessageForCode, buildApiErrorResponse, validationBaseMessage } from '@platform/shared';
import type { ApiErrorKey, ApiErrorParams, ApiErrorResponse } from '@platform/shared';

/**
 * Exception body for a user-facing failure (docs/I18N.md, "API hata mesajları").
 *
 *   throw new NotFoundException(apiError('apiErrors.common.memberNotFound'));
 *   throw new BadRequestException(apiError('apiErrors.growth.invalidOperator', { op }));
 *
 * Nest sends an object passed to an exception unchanged, so the response is
 * `{ code: '<key>', message: '<Turkish text>', params? }`: `message` keeps old
 * clients working, `code` and `params` let web and mobile show the text in the
 * viewer's language.
 */
export function apiError(key: ApiErrorKey, params?: ApiErrorParams): ApiErrorResponse {
  return buildApiErrorResponse(key, params);
}

/**
 * Like `apiError`, for an error that keeps an older stable code that clients
 * already branch on (e.g. TRANSLATION_JOB_ACTIVE): the body is
 * `{ ...extra, code, messageKey, message, params? }`.
 */
export function apiErrorWithCode(code: string, key: ApiErrorKey, params?: ApiErrorParams, extra: Record<string, unknown> = {}): ApiErrorResponse & Record<string, unknown> {
  return { ...extra, ...buildApiErrorResponse(key, params, code) };
}

/** True when `error` is an HttpException whose body carries the given `apiErrors` key as its code. */
export function hasApiErrorCode(error: unknown, key: ApiErrorKey): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === key;
}

/**
 * Exception body for an error that keeps a stable code of its own (retail,
 * loyalty, billing, ... codes). The Turkish `message` comes from the
 * translation the code already has, so the text lives in one place only;
 * `extra` carries fields such as `statusCode` or `issues`.
 */
export function codedError(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra, code, message: apiErrorBaseMessageForCode(code) ?? code };
}

/**
 * One entry of `errors[]`: `message` is the Turkish text (older clients), `messageKey` the
 * `validation.*` key (with params) that web and mobile translate; a plain sentence has no key.
 */
export function fieldError(path: string, message: string): { path: string; message: string; messageKey?: string } {
  const text = validationBaseMessage(message);
  return text === message ? { path, message } : { path, message: text, messageKey: message };
}
