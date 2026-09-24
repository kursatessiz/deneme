import { UseGuards, applyDecorators } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SuperAdminGuard } from '../guards/super-admin.guard';

/**
 * JWT authentication + super-admin (platform owner) check, in that order.
 * Apply at controller level for every route under the `/admin/*` prefix,
 * and on individual handlers where a controller mixes admin and tenant
 * routes (e.g. StudiosController#findAll).
 */
export const SuperAdminOnly = () => applyDecorators(UseGuards(JwtAuthGuard, SuperAdminGuard));
