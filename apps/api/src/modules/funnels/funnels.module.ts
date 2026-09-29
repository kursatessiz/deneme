import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FunnelsController } from './funnels.controller';
import { FunnelsService } from './funnels.service';

/** Conversion funnels (G5d-1): ready-made and tenant-defined, computed from ConversionEvent. */
@Module({
  imports: [AuthModule],
  controllers: [FunnelsController],
  providers: [FunnelsService],
  exports: [FunnelsService],
})
export class FunnelsModule {}
