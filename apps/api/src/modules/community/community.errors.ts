import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { CommunityErrorCode } from '@platform/shared';
import { codedError } from '../../common/api-error';

/**
 * Community errors carry a stable `code` (COMMUNITY_ERROR_CODES) next to the
 * translated message; clients translate `community.error.<code>`.
 */
export function communityError(code: CommunityErrorCode): HttpException {
  const body = (statusCode: number) => codedError(code, { statusCode });
  switch (code) {
    case 'COMMUNITY_POST_NOT_FOUND':
      return new NotFoundException(body(404));
    case 'COMMUNITY_COMMENT_NOT_FOUND':
      return new NotFoundException(body(404));
    case 'COMMUNITY_TIER_NOT_FOUND':
      return new BadRequestException(body(400));
    case 'COMMUNITY_TIER_IN_USE':
      return new ConflictException(body(409));
    case 'COMMUNITY_VIDEO_NOT_FOUND':
      return new BadRequestException(body(400));
    case 'COMMUNITY_PACKAGE_NOT_FOUND':
      return new BadRequestException(body(400));
    case 'COMMUNITY_POST_INVALID':
      return new BadRequestException(body(400));
    case 'COMMUNITY_POST_NOT_PUBLISHED':
      return new ConflictException(body(409));
    case 'COMMUNITY_COMMENTS_DISABLED':
      return new ConflictException(body(409));
    case 'COMMUNITY_MEMBERS_ONLY':
      return new ForbiddenException(body(403));
    case 'COMMUNITY_NOT_COMMENT_AUTHOR':
      return new ForbiddenException(body(403));
  }
}
