import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  LoginSchema,
  PinLoginSchema,
  RequestLoginOtpSchema,
  SetPinSchema,
  VerifyLoginOtpSchema,
} from '@platform/shared';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { AuthUser } from './tenant-context';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@ZodBody(LoginSchema) body: ReturnType<typeof LoginSchema.parse>) {
    return this.authService.login(body);
  }

  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@ZodBody(RequestLoginOtpSchema) body: ReturnType<typeof RequestLoginOtpSchema.parse>, @Req() req: Request) {
    return this.authService.requestLoginOtp(body.phone, req.ip ?? null);
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@ZodBody(VerifyLoginOtpSchema) body: ReturnType<typeof VerifyLoginOtpSchema.parse>) {
    return this.authService.verifyLoginOtp(body.phone, body.code);
  }

  @Post('pin/login')
  @HttpCode(200)
  async pinLogin(@ZodBody(PinLoginSchema) body: ReturnType<typeof PinLoginSchema.parse>) {
    return this.authService.pinLogin(body.phone, body.pin);
  }

  @Put('pin')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async setPin(@CurrentUser() user: AuthUser, @ZodBody(SetPinSchema) body: ReturnType<typeof SetPinSchema.parse>) {
    await this.authService.setPin(user.id, body.pin);
  }

  // Not behind JwtAuthGuard: the access token is usually expired by the time
  // a client refreshes. The refresh token is verified on its own.
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthUser) {
    await this.authService.logout(user.id);
  }

  /** Identity plus memberships; clients build menus from the permissions. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return this.authService.sessionUser(user.id);
  }
}
