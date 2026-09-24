import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchesController, PortfolioController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [AuthModule],
  controllers: [BranchesController, PortfolioController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
