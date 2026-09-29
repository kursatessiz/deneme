import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ChangePlatformRoleSchema,
  PlatformAccessSettingsSchema,
  PlatformInviteSchema,
  type ChangePlatformRoleInput,
  type PlatformAccessSettingsInput,
  type PlatformInviteInput,
} from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Platform, PlatformAnyAccess, PlatformScoped } from '../auth/decorators/platform-scoped.decorator';
import type { AuthUser, PlatformContext } from '../auth/tenant-context';
import { ZodBody } from '../../common/zod-body.pipe';
import { PlatformUsersService } from './platform-users.service';

/**
 * Super admin only (`platform.users.manage` is never granted through a
 * template): /admin/platform-kullanicilari in the web panel.
 */
@Controller('admin/platform-users')
@SuperAdminOnly()
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get('role-templates')
  roleTemplates() {
    return this.users.roleTemplates();
  }

  @Get('settings')
  settings() {
    return this.users.settings();
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: AuthUser, @ZodBody(PlatformAccessSettingsSchema) body: PlatformAccessSettingsInput) {
    return this.users.updateSettings(user.id, body);
  }

  @Post('invites')
  invite(@CurrentUser() user: AuthUser, @ZodBody(PlatformInviteSchema) body: PlatformInviteInput) {
    return this.users.invite(user.id, body);
  }

  @Put(':userId/role')
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ZodBody(ChangePlatformRoleSchema) body: ChangePlatformRoleInput,
  ) {
    return this.users.changeRole(user.id, userId, body.roleTemplateId);
  }

  @Post(':userId/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.users.deactivate(user.id, userId);
  }

  @Post(':userId/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.users.reactivate(user.id, userId);
  }

  @Post(':userId/mfa/reset')
  @HttpCode(200)
  resetMfa(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.users.resetMfa(user.id, userId);
  }
}

/** Shell context of the marketing panel: the platform tenant and the caller's effective permissions. */
@Controller('platform')
@PlatformScoped()
export class PlatformContextController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get('context')
  @PlatformAnyAccess()
  context(@Platform() platform: PlatformContext) {
    return this.users.context(platform);
  }
}
