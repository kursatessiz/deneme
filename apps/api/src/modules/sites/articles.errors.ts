import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { ArticleErrorCode } from '@platform/shared';

/**
 * Article errors carry a stable `code` (ARTICLE_ERROR_CODES) next to an
 * English diagnostic message for logs; clients translate `articles.error.<code>`.
 */
export function articleError(code: ArticleErrorCode): HttpException {
  const body = (statusCode: number, message: string) => ({ statusCode, code, message });
  switch (code) {
    case 'ARTICLE_NOT_FOUND':
      return new NotFoundException(body(404, 'Article not found'));
    case 'ARTICLE_SLUG_TAKEN':
      return new ConflictException(body(409, 'Slug already used by another article in this locale'));
    case 'ARTICLE_TAG_NOT_FOUND':
      return new NotFoundException(body(404, 'Tag not found on this site'));
    case 'ARTICLE_TAG_SLUG_TAKEN':
      return new ConflictException(body(409, 'Tag slug already used on this site'));
    case 'ARTICLE_NOT_DELETABLE':
      return new ConflictException(body(409, 'A published article cannot be deleted; archive it first'));
  }
}
