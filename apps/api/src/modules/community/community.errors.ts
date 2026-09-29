import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { CommunityErrorCode } from '@platform/shared';

/**
 * Community errors carry a stable `code` (COMMUNITY_ERROR_CODES) next to an
 * English diagnostic message for logs; clients translate
 * `community.error.<code>`.
 */
export function communityError(code: CommunityErrorCode): HttpException {
  const body = (statusCode: number, message: string) => ({ statusCode, code, message });
  switch (code) {
    case 'COMMUNITY_POST_NOT_FOUND':
      return new NotFoundException(body(404, 'Post not found'));
    case 'COMMUNITY_COMMENT_NOT_FOUND':
      return new NotFoundException(body(404, 'Comment not found'));
    case 'COMMUNITY_TIER_NOT_FOUND':
      return new BadRequestException(body(400, 'Access tier not found in this studio'));
    case 'COMMUNITY_TIER_IN_USE':
      return new ConflictException(body(409, 'Access tier is still used by a post'));
    case 'COMMUNITY_VIDEO_NOT_FOUND':
      return new BadRequestException(body(400, 'Video content not found in this studio'));
    case 'COMMUNITY_PACKAGE_NOT_FOUND':
      return new BadRequestException(body(400, 'Package definition not found in this studio'));
    case 'COMMUNITY_POST_INVALID':
      return new BadRequestException(body(400, 'The post type needs different fields'));
    case 'COMMUNITY_POST_NOT_PUBLISHED':
      return new ConflictException(body(409, 'Post is not published'));
    case 'COMMUNITY_COMMENTS_DISABLED':
      return new ConflictException(body(409, 'Comments are turned off for this post'));
    case 'COMMUNITY_MEMBERS_ONLY':
      return new ForbiddenException(body(403, 'Only members can use the community feed'));
    case 'COMMUNITY_NOT_COMMENT_AUTHOR':
      return new ForbiddenException(body(403, 'Only the author can delete this comment'));
  }
}
