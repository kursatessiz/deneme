import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { MfaConfirmSchema, MfaVerifySchema, type MfaConfirmInput, type MfaVerifyInput } from '@platform/shared';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ZodBody } from '../../../common/zod-body.pipe';
import type { AuthUser } from '../tenant-context';
import { MfaService } from './mfa.service';

/**
 * Two-step verification (TOTP) endpoints. Only a plain session is needed:
 * an account that must enrol can do so right after signing in. The
 * responses of confirm and verify carry a new token pair, which the web BFF
 * turns into cookies (lib/bff/auth-paths.ts).
 */
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('enroll')
  @HttpCode(200)
  enroll(@CurrentUser() user: AuthUser) {
    return this.mfa.beginEnrollment(user.id);
  }

  @Post('enroll/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @ZodBody(MfaConfirmSchema) body: MfaConfirmInput, @Req() req: Request) {
    return this.mfa.confirmEnrollment(user.id, body.code, req.ip ?? null);
  }

  @Post('verify')
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @ZodBody(MfaVerifySchema) body: MfaVerifyInput, @Req() req: Request) {
    return this.mfa.verify(user.id, body, req.ip ?? null);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() user: AuthUser, @ZodBody(MfaConfirmSchema) body: MfaConfirmInput, @Req() req: Request) {
    return this.mfa.regenerateRecoveryCodes(user.id, body.code, req.ip ?? null);
  }
}
