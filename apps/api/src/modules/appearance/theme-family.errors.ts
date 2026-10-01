import { ForbiddenException } from '@nestjs/common';
import { THEME_FAMILY_NOT_ALLOWED } from '@platform/shared';

/**
 * 403 for a theme write that names a family the super admin has not allowed.
 * The body carries the stable `code`; clients translate
 * `themeDesign.error.<code>`. The message is an English diagnostic for logs.
 */
export function themeFamilyNotAllowed(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: THEME_FAMILY_NOT_ALLOWED,
    message: 'This theme family is not enabled for the studio',
  });
}
