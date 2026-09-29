import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { RequirePermission, StudioScoped } from '../auth/decorators/require-permission.decorator';

/**
 * Routes that fail on purpose, registered only when NODE_ENV=test (see
 * ErrorReportingModule): the e2e suite proves 5xx capture, PII masking and
 * that 4xx are not recorded. `:tag` makes each scenario its own group.
 */
@Controller('telemetry/test')
export class TestErrorController {
  @Get('boom/:tag')
  boom(@Param('tag') tag: string): never {
    throw new Error(`Test failure ${tag} for ada.lovelace@example.com at +905321000002 with password=hunter2`);
  }

  @Get('bad-request/:tag')
  badRequest(@Param('tag') tag: string): never {
    throw new BadRequestException(`Expected client error ${tag}`);
  }

  @Get('payments/boom/:tag')
  paymentsBoom(@Param('tag') tag: string): never {
    throw new Error(`Payment test failure ${tag}`);
  }

  @Get('studios/:studioId/boom/:tag')
  @StudioScoped()
  @RequirePermission('studio.settings.view')
  studioBoom(@Param('tag') tag: string): never {
    throw new TypeError(`Studio test failure ${tag}`);
  }
}
