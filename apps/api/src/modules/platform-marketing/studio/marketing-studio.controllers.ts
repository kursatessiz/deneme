import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  AbTestSetupSchema,
  AddVariantsSchema,
  ContentItemsQuerySchema,
  CreateContentItemSchema,
  DraftListQuerySchema,
  ExportToCampaignSchema,
  GenerateDraftsSchema,
  ProductFactInputSchema,
  ResearchRequestSchema,
  SuggestSegmentsSchema,
  UpdateContentItemSchema,
  UpdateDraftSchema,
  UpdateProductFactSchema,
  UpdateVariantSchema,
  UpsertBrandKitSchema,
  type AbTestSetupInput,
  type AddVariantsInput,
  type ContentItemsQuery,
  type CreateContentItemInput,
  type DraftListQuery,
  type ExportToCampaignInput,
  type GenerateDraftsInput,
  type ProductFactInput,
  type ResearchRequestInput,
  type SuggestSegmentsInput,
  type UpdateContentItemInput,
  type UpdateDraftInput,
  type UpdateProductFactInput,
  type UpdateVariantInput,
  type UpsertBrandKitInput,
} from '@platform/shared';
import { Platform, PlatformScoped, RequirePlatformPermission } from '../../auth/decorators/platform-scoped.decorator';
import type { PlatformContext } from '../../auth/tenant-context';
import { ZodBody, ZodQuery } from '../../../common/zod-body.pipe';
import { BrandKitService } from './brand-kit.service';
import { ContentCalendarService } from './content-calendar.service';
import { MarketingAiRateLimitGuard } from './marketing-ai-rate-limit.guard';
import { MarketingAiService } from './marketing-ai.service';
import { MarketingDraftsService } from './marketing-drafts.service';

/** Brand kit and product facts (M2a): read with platform.marketing.view, write with platform.brand.manage. */
@Controller('platform/marketing/brand-kit')
@PlatformScoped()
export class BrandKitController {
  constructor(private readonly brandKit: BrandKitService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  view(@Platform() platform: PlatformContext) {
    return this.brandKit.view(platform);
  }

  @Put()
  @RequirePlatformPermission('platform.brand.manage')
  upsert(@Platform() platform: PlatformContext, @ZodBody(UpsertBrandKitSchema) body: UpsertBrandKitInput) {
    return this.brandKit.upsert(platform, body);
  }

  @Post('facts')
  @RequirePlatformPermission('platform.brand.manage')
  createFact(@Platform() platform: PlatformContext, @ZodBody(ProductFactInputSchema) body: ProductFactInput) {
    return this.brandKit.createFact(platform, body);
  }

  @Patch('facts/:id')
  @RequirePlatformPermission('platform.brand.manage')
  updateFact(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(UpdateProductFactSchema) body: UpdateProductFactInput) {
    return this.brandKit.updateFact(platform, id, body);
  }

  @Delete('facts/:id')
  @RequirePlatformPermission('platform.brand.manage')
  removeFact(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.brandKit.removeFact(platform, id);
  }
}

/** AI studio (M2b, M2d): every route needs platform.ai.use; nothing here sends or publishes anything. */
@Controller('platform/marketing/studio')
@PlatformScoped()
@RequirePlatformPermission('platform.ai.use')
export class MarketingStudioController {
  constructor(
    private readonly ai: MarketingAiService,
    private readonly drafts: MarketingDraftsService,
    private readonly brandKit: BrandKitService,
  ) {}

  /** The brand kit the studio writes within (languages, audiences); the editor and the facts stay behind platform.marketing.view. */
  @Get('kit')
  kit(@Platform() platform: PlatformContext) {
    return this.brandKit.kitOnly(platform);
  }

  @Get('status')
  status(@Platform() platform: PlatformContext) {
    return this.ai.status(platform);
  }

  @Get('segment-insight')
  segmentInsight(@Platform() platform: PlatformContext) {
    return this.ai.segmentInsight(platform);
  }

  @Post('generate')
  @HttpCode(200)
  @UseGuards(MarketingAiRateLimitGuard)
  generate(@Platform() platform: PlatformContext, @ZodBody(GenerateDraftsSchema) body: GenerateDraftsInput) {
    return this.ai.generate(platform, body);
  }

  @Post('segment-suggestions')
  @HttpCode(200)
  @UseGuards(MarketingAiRateLimitGuard)
  suggestSegments(@Platform() platform: PlatformContext, @ZodBody(SuggestSegmentsSchema) body: SuggestSegmentsInput) {
    return this.ai.suggestSegments(platform, body);
  }

  @Post('research')
  @HttpCode(200)
  @UseGuards(MarketingAiRateLimitGuard)
  research(@Platform() platform: PlatformContext, @ZodBody(ResearchRequestSchema) body: ResearchRequestInput) {
    return this.ai.research(platform, body);
  }

  @Get('drafts')
  list(@Platform() platform: PlatformContext, @ZodQuery(DraftListQuerySchema) query: DraftListQuery) {
    return this.drafts.list(platform, query);
  }

  @Get('drafts/:id')
  get(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.get(platform, id);
  }

  @Patch('drafts/:id')
  update(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(UpdateDraftSchema) body: UpdateDraftInput) {
    return this.drafts.update(platform, id, body);
  }

  @Post('drafts/:id/variants')
  @HttpCode(200)
  @UseGuards(MarketingAiRateLimitGuard)
  addVariants(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(AddVariantsSchema) body: AddVariantsInput) {
    return this.ai.addVariants(platform, id, body);
  }

  @Patch('drafts/:id/variants/:variantId')
  updateVariant(
    @Platform() platform: PlatformContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @ZodBody(UpdateVariantSchema) body: UpdateVariantInput,
  ) {
    return this.drafts.updateVariant(platform, id, variantId, body);
  }

  @Put('drafts/:id/ab-test')
  setAbTest(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(AbTestSetupSchema) body: AbTestSetupInput) {
    return this.drafts.setAbTest(platform, id, body);
  }

  /** Creates a message template and a DRAFT campaign; needs the campaign right as well (platform.marketing.manage). */
  @Post('drafts/:id/export-campaign')
  @HttpCode(200)
  @RequirePlatformPermission('platform.ai.use', 'platform.marketing.manage')
  exportCampaign(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(ExportToCampaignSchema) body: ExportToCampaignInput) {
    return this.drafts.exportToCampaign(platform, id, body);
  }
}

/** Content calendar (M2c): read with platform.marketing.view, change with platform.marketing.manage. */
@Controller('platform/marketing/calendar')
@PlatformScoped()
export class ContentCalendarController {
  constructor(private readonly calendar: ContentCalendarService) {}

  @Get()
  @RequirePlatformPermission('platform.marketing.view')
  list(@Platform() platform: PlatformContext, @ZodQuery(ContentItemsQuerySchema) query: ContentItemsQuery) {
    return this.calendar.list(platform, query);
  }

  @Get('owners')
  @RequirePlatformPermission('platform.marketing.view')
  owners() {
    return this.calendar.owners();
  }

  @Post('items')
  @RequirePlatformPermission('platform.marketing.manage')
  create(@Platform() platform: PlatformContext, @ZodBody(CreateContentItemSchema) body: CreateContentItemInput) {
    return this.calendar.create(platform, body);
  }

  @Patch('items/:id')
  @RequirePlatformPermission('platform.marketing.manage')
  update(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @ZodBody(UpdateContentItemSchema) body: UpdateContentItemInput) {
    return this.calendar.update(platform, id, body);
  }

  @Delete('items/:id')
  @RequirePlatformPermission('platform.marketing.manage')
  remove(@Platform() platform: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(platform, id);
  }
}
