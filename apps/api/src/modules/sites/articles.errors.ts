import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { ArticleErrorCode } from '@platform/shared';
import { codedError } from '../../common/api-error';

/**
 * Article errors carry a stable `code` (ARTICLE_ERROR_CODES) next to an
 * translated message; clients translate `articles.error.<code>`.
 */
export function articleError(code: ArticleErrorCode): HttpException {
  const body = (statusCode: number) => codedError(code, { statusCode });
  switch (code) {
    case 'ARTICLE_NOT_FOUND':
      return new NotFoundException(body(404));
    case 'ARTICLE_SLUG_TAKEN':
      return new ConflictException(body(409));
    case 'ARTICLE_TAG_NOT_FOUND':
      return new NotFoundException(body(404));
    case 'ARTICLE_TAG_SLUG_TAKEN':
      return new ConflictException(body(409));
    case 'ARTICLE_NOT_DELETABLE':
      return new ConflictException(body(409));
  }
}
