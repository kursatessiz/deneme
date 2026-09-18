import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { MembersService } from './members.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioTenantGuard } from '../auth/guards/studio-tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CreateMemberSchema,
  CreateMemberInput,
  AssignPackageToMemberSchema,
  AssignPackageToMemberInput,
} from '@pilates/shared';

@Controller('members')
@UseGuards(JwtAuthGuard, StudioTenantGuard, RolesGuard)
export class MembersController {
  constructor(private membersService: MembersService) {}

  @Get('studio/:studioId')
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST', 'TRAINER')
  async findAll(
    @Param('studioId') studioId: string,
    @Query('search') search?: string,
  ) {
    return this.membersService.findAll(studioId, search);
  }

  @Get(':memberId/studio/:studioId')
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST', 'TRAINER')
  async findById(
    @Param('memberId') memberId: string,
    @Param('studioId') studioId: string,
  ) {
    return this.membersService.findById(memberId, studioId);
  }

  @Post()
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST')
  async createMember(@Body() body: CreateMemberInput) {
    const validated = CreateMemberSchema.parse(body);
    return this.membersService.createMember(validated);
  }

  @Post('packages/assign')
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST')
  async assignPackage(@Body() body: AssignPackageToMemberInput) {
    const validated = AssignPackageToMemberSchema.parse(body);
    return this.membersService.assignPackage(validated);
  }

  @Post('packages/:packageId/freeze')
  @Roles('STUDIO_ADMIN', 'RECEPTIONIST')
  async freezePackage(
    @Param('packageId') packageId: string,
    @Body('studioId') studioId: string,
    @Body('days') days: number,
    @Body('reason') reason: string,
  ) {
    return this.membersService.freezePackage(packageId, studioId, days, reason);
  }
}
