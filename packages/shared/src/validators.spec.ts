import {
  LoginSchema,
  CreateMemberSchema,
  CreatePackageDefinitionSchema,
  CreateScheduleSchema,
  BookSessionSchema,
  CancelBookingSchema,
  SessionType,
  PaymentMethod,
} from './index';

describe('Shared Zod Validators', () => {
  describe('LoginSchema', () => {
    it('should validate valid email and password', () => {
      const input = {
        emailOrPhone: 'elif@zenpilates.com',
        password: 'password123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate valid phone and password', () => {
      const input = {
        emailOrPhone: '05551112233',
        password: 'password123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should fail if password is too short (< 6 chars)', () => {
      const input = {
        emailOrPhone: '05551112233',
        password: '123',
      };
      const result = LoginSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('en az 6 karakter');
      }
    });
  });

  describe('CreateMemberSchema', () => {
    const validMember = {
      studioId: '123e4567-e89b-12d3-a456-426614174000',
      firstName: 'Ayşe',
      lastName: 'Demir',
      phone: '05553334455',
      email: 'ayse@example.com',
      medicalConditions: 'L4-L5 Bel Fıtığı başlangıcı',
      hasSignedWaiver: true,
    };

    it('should validate a full valid member profile', () => {
      const result = CreateMemberSchema.safeParse(validMember);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for studioId', () => {
      const result = CreateMemberSchema.safeParse({
        ...validMember,
        studioId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid phone format if too short', () => {
      const result = CreateMemberSchema.safeParse({
        ...validMember,
        phone: '123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreatePackageDefinitionSchema', () => {
    it('should validate standard 10 session reformer package', () => {
      const input = {
        studioId: '123e4567-e89b-12d3-a456-426614174000',
        name: '10 Seans Birebir Reformer',
        sessionType: SessionType.PRIVATE_REFORMER,
        totalSessions: 10,
        validityDays: 60,
        price: 12000,
        freezeDaysAllowed: 15,
      };
      const result = CreatePackageDefinitionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject negative price', () => {
      const input = {
        studioId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Bedava Paket',
        sessionType: SessionType.PRIVATE_REFORMER,
        totalSessions: 10,
        validityDays: 60,
        price: -500,
      };
      const result = CreatePackageDefinitionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('CancelBookingSchema', () => {
    it('should accept valid cancellation request', () => {
      const input = {
        bookingId: '123e4567-e89b-12d3-a456-426614174000',
        cancelledBy: 'MEMBER',
        reason: 'Hastalık mazereti',
      };
      const result = CancelBookingSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
