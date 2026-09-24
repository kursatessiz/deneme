import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { StudiosModule } from './modules/studios/studios.module';
import { MembersModule } from './modules/members/members.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { TrainersModule } from './modules/trainers/trainers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './modules/redis/redis.module';
import { OtpModule } from './modules/otp/otp.module';
import { InvitesModule } from './modules/invites/invites.module';
import { MeModule } from './modules/me/me.module';
import { AppearanceModule } from './modules/appearance/appearance.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { BranchesModule } from './modules/branches/branches.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { validateEnv } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    StudiosModule,
    MembersModule,
    SchedulesModule,
    TrainersModule,
    NotificationsModule,
    OtpModule,
    InvitesModule,
    MeModule,
    AppearanceModule,
    CatalogModule,
    BranchesModule,
    PaymentsModule,
    HealthModule,
  ],
})
export class AppModule {}
