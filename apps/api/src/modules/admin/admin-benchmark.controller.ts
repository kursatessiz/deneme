import { Controller, Get } from '@nestjs/common';
import { BenchmarkQuerySchema } from '@platform/shared';
import type { BenchmarkQueryInput } from '@platform/shared';
import { SuperAdminOnly } from '../auth/decorators/super-admin-only.decorator';
import { ZodQuery } from '../../common/zod-body.pipe';
import { AdminBenchmarkService } from './admin-benchmark.service';

@Controller('admin/benchmark')
@SuperAdminOnly()
export class AdminBenchmarkController {
  constructor(private readonly benchmark: AdminBenchmarkService) {}

  @Get()
  async get(@ZodQuery(BenchmarkQuerySchema) query: BenchmarkQueryInput) {
    return { buckets: await this.benchmark.compute(query.businessTypeTemplateKey) };
  }
}
