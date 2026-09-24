import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppearanceService } from './appearance.service';
import { MeAppearanceController, StudioThemeController } from './appearance.controller';

@Module({
  imports: [AuthModule],
  controllers: [MeAppearanceController, StudioThemeController],
  providers: [AppearanceService],
})
export class AppearanceModule {}
