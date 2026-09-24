import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChurnController } from './churn.controller';
import { ChurnAdminController } from './churn-admin.controller';
import { ChurnService } from './churn.service';

@Module({
  imports: [AuthModule],
  controllers: [ChurnController, ChurnAdminController],
  providers: [ChurnService],
  exports: [ChurnService],
})
export class ChurnModule {}
