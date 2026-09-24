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
    HealthModule,
  ],
})
export class AppModule {}
