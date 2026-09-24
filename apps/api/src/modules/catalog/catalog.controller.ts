import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { StudioScoped, RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Tenant } from '../auth/decorators/current-user.decorator';
import { ZodBody } from '../../common/zod-body.pipe';
import type { TenantContext } from '../auth/tenant-context';
import {
  CreateResourceTypeSchema,
  CreateResourceTypeInput,
  UpdateResourceTypeSchema,
  UpdateResourceTypeInput,
  CreateResourceSchema,
  CreateResourceInput,
  UpdateResourceSchema,
  UpdateResourceInput,
  CreateCancellationPolicySchema,
  CreateCancellationPolicyInput,
  UpdateCancellationPolicySchema,
  UpdateCancellationPolicyInput,
  CreateServiceTypeSchema,
  CreateServiceTypeInput,
  UpdateServiceTypeSchema,
  UpdateServiceTypeInput,
  ServiceTypeQualificationSchema,
  ServiceTypeQualificationInput,
  DeactivateCatalogItemSchema,
  DeactivateCatalogItemInput,
} from '@platform/shared';

@Controller('catalog')
@StudioScoped()
export class CatalogController {
  constructor(private catalog: CatalogService) {}

  // Resource types ---------------------------------------------------------

  @Get('resource-types/studio/:studioId')
  @RequirePermission('catalog.view')
  listResourceTypes(@Tenant() tenant: TenantContext) {
    return this.catalog.listResourceTypes(tenant);
  }

  @Post('resource-types')
  @RequirePermission('catalog.manage')
  createResourceType(@Tenant() tenant: TenantContext, @ZodBody(CreateResourceTypeSchema) body: CreateResourceTypeInput) {
    return this.catalog.createResourceType(tenant, body);
  }

  @Patch('resource-types/:id')
  @RequirePermission('catalog.manage')
  updateResourceType(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateResourceTypeSchema) body: UpdateResourceTypeInput,
  ) {
    return this.catalog.updateResourceType(tenant, id, body);
  }

  @Post('resource-types/:id/deactivate')
  @RequirePermission('catalog.manage')
  deactivateResourceType(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(DeactivateCatalogItemSchema) _body: DeactivateCatalogItemInput,
  ) {
    return this.catalog.deactivateResourceType(tenant, id);
  }

  // Resources ---------------------------------------------------------------

  @Get('resources/studio/:studioId')
  @RequirePermission('catalog.view')
  listResources(@Tenant() tenant: TenantContext) {
    return this.catalog.listResources(tenant);
  }

  @Post('resources')
  @RequirePermission('catalog.manage')
  createResource(@Tenant() tenant: TenantContext, @ZodBody(CreateResourceSchema) body: CreateResourceInput) {
    return this.catalog.createResource(tenant, body);
  }

  @Patch('resources/:id')
  @RequirePermission('catalog.manage')
  updateResource(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateResourceSchema) body: UpdateResourceInput,
  ) {
    return this.catalog.updateResource(tenant, id, body);
  }

  @Post('resources/:id/deactivate')
  @RequirePermission('catalog.manage')
  deactivateResource(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(DeactivateCatalogItemSchema) _body: DeactivateCatalogItemInput,
  ) {
    return this.catalog.deactivateResource(tenant, id);
  }

  // Cancellation policies -----------------------------------------------------

  @Get('cancellation-policies/studio/:studioId')
  @RequirePermission('catalog.view')
  listCancellationPolicies(@Tenant() tenant: TenantContext) {
    return this.catalog.listCancellationPolicies(tenant);
  }

  @Post('cancellation-policies')
  @RequirePermission('catalog.manage')
  createCancellationPolicy(
    @Tenant() tenant: TenantContext,
    @ZodBody(CreateCancellationPolicySchema) body: CreateCancellationPolicyInput,
  ) {
    return this.catalog.createCancellationPolicy(tenant, body);
  }

  @Patch('cancellation-policies/:id')
  @RequirePermission('catalog.manage')
  updateCancellationPolicy(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateCancellationPolicySchema) body: UpdateCancellationPolicyInput,
  ) {
    return this.catalog.updateCancellationPolicy(tenant, id, body);
  }

  @Post('cancellation-policies/:id/deactivate')
  @RequirePermission('catalog.manage')
  deactivateCancellationPolicy(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(DeactivateCatalogItemSchema) _body: DeactivateCatalogItemInput,
  ) {
    return this.catalog.deactivateCancellationPolicy(tenant, id);
  }

  // Service types -------------------------------------------------------------

  @Get('service-types/studio/:studioId')
  @RequirePermission('catalog.view')
  listServiceTypes(@Tenant() tenant: TenantContext) {
    return this.catalog.listServiceTypes(tenant);
  }

  @Post('service-types')
  @RequirePermission('catalog.manage')
  createServiceType(@Tenant() tenant: TenantContext, @ZodBody(CreateServiceTypeSchema) body: CreateServiceTypeInput) {
    return this.catalog.createServiceType(tenant, body);
  }

  @Patch('service-types/:id')
  @RequirePermission('catalog.manage')
  updateServiceType(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(UpdateServiceTypeSchema) body: UpdateServiceTypeInput,
  ) {
    return this.catalog.updateServiceType(tenant, id, body);
  }

  @Post('service-types/:id/deactivate')
  @RequirePermission('catalog.manage')
  deactivateServiceType(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(DeactivateCatalogItemSchema) _body: DeactivateCatalogItemInput,
  ) {
    return this.catalog.deactivateServiceType(tenant, id);
  }

  @Post('service-types/:id/qualifications')
  @RequirePermission('catalog.manage')
  addQualification(
    @Param('id') id: string,
    @Tenant() tenant: TenantContext,
    @ZodBody(ServiceTypeQualificationSchema) body: ServiceTypeQualificationInput,
  ) {
    return this.catalog.addQualification(tenant, id, body);
  }

  @Delete('service-types/:id/qualifications/:trainerProfileId')
  @RequirePermission('catalog.manage')
  removeQualification(
    @Param('id') id: string,
    @Param('trainerProfileId') trainerProfileId: string,
    @Tenant() tenant: TenantContext,
  ) {
    return this.catalog.removeQualification(tenant, id, trainerProfileId);
  }
}
