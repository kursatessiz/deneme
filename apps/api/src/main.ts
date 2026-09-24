import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Credentials are only allowed together with an explicit origin list.
  // Env validation rejects a wildcard origin in production.
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  const origins = corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : [];
  app.enableCors({
    origin: origins.length > 0 ? origins : !isProduction,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: origins.length > 0,
  });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Core API')
      .setDescription('Multi-tenant membership and appointment platform REST API')
      .setVersion(config.get<string>('APP_VERSION', '0.0.0'))
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on port ${port}`);
  if (!isProduction) logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();
