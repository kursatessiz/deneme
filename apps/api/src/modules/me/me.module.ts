import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { MeController } from './me.controller';

@Module({
  imports: [CalendarModule],
  controllers: [MeController],
})
export class MeModule {}
