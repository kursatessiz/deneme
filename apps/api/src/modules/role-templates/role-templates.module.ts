import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoleTemplatesController } from './role-templates.controller';
import { RoleTemplatesService } from './role-templates.service';

@Module({
  imports: [AuthModule],
  controllers: [RoleTemplatesController],
  providers: [RoleTemplatesService],
})
export class RoleTemplatesModule {}
