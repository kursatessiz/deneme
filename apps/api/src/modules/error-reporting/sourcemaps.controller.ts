import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SOURCEMAP_LIMITS, SourcemapUploadSchema, normalizeSourcemapPath } from '@platform/shared';
import type { SourcemapUploadResult } from '@platform/shared';
import { SourcemapStoreError, SourcemapStoreService } from './sourcemap-store.service';
import { sourcemapTokenValid } from './sourcemap-token';

/**
 * Source map upload for stack symbolication (H2). Called by CI (web) and
 * the mobile upload script with the dedicated SOURCEMAP_UPLOAD_TOKEN, not a
 * user session: a pipeline has no super admin login, and the token is a
 * platform-owner secret. Without a configured token the endpoint is off.
 */
@Controller('admin/errors/sourcemaps')
export class SourcemapsController {
  constructor(
    private readonly store: SourcemapStoreService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(201)
  async upload(@Req() req: Request, @Body() body: unknown): Promise<SourcemapUploadResult> {
    if (!sourcemapTokenValid(req, this.config.get<string>('SOURCEMAP_UPLOAD_TOKEN'))) throw new ForbiddenException();
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > SOURCEMAP_LIMITS.bodyBytes) throw new HttpException('Request body too large', HttpStatus.PAYLOAD_TOO_LARGE);

    const parsed = SourcemapUploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid request', errors: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
    const path = normalizeSourcemapPath(parsed.data.path);
    if (!path) throw new BadRequestException('Invalid bundle path');
    const mapText = typeof parsed.data.map === 'string' ? parsed.data.map : JSON.stringify(parsed.data.map);
    if (Buffer.byteLength(mapText) > SOURCEMAP_LIMITS.fileBytes) throw new HttpException('Source map too large', HttpStatus.PAYLOAD_TOO_LARGE);
    try {
      return await this.store.save({ platform: parsed.data.platform, release: parsed.data.release, path, mapText });
    } catch (err) {
      if (err instanceof SourcemapStoreError) {
        throw err.code === 'TOO_MANY_FILES' ? new HttpException(err.message, HttpStatus.CONFLICT) : new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
