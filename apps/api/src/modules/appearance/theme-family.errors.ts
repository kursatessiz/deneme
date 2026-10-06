import { ForbiddenException } from '@nestjs/common';
import { THEME_FAMILY_NOT_ALLOWED } from '@platform/shared';
import { codedError } from '../../common/api-error';

/**
 * 403 for a theme write that names a family the super admin has not allowed.
 * The body carries the stable `code`; clients translate
 * `themeDesign.error.<code>`. The message is an English diagnostic for logs.
 */
export function themeFamilyNotAllowed(): ForbiddenException {
  return new ForbiddenException(codedError(THEME_FAMILY_NOT_ALLOWED, { statusCode: 403 }));
}
