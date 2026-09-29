import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { StudioTenantGuard } from './guards/studio-tenant.guard';
import { PermissionGuard } from './guards/permission.guard';
import { BillingWriteGuard } from './guards/billing-write.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PlatformPermissionGuard } from './guards/platform-permission.guard';
import { MfaService } from './mfa/mfa.service';
import { MfaController } from './mfa/mfa.controller';
import { CredentialCipher } from '../../common/crypto/credential-cipher';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [
    AuthService,
    LoginThrottleService,
    JwtStrategy,
    StudioTenantGuard,
    PermissionGuard,
    BillingWriteGuard,
    PlatformPermissionGuard,
    CredentialCipher,
    MfaService,
  ],
  exports: [AuthService, StudioTenantGuard, PermissionGuard, BillingWriteGuard, PlatformPermissionGuard, LoginThrottleService, PassportModule, JwtModule],
})
export class AuthModule {}
