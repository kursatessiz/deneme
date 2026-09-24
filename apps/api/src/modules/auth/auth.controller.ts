import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { LoginSchema } from '@platform/shared';
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
