import { PrismaClient, Role, SessionType, PackageStatus, BookingStatus, PaymentMethod, CommissionType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Platform Database...');

  // Clean existing data
  await prisma.auditLog.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.packageFreezeHistory.deleteMany({});
  await prisma.memberPackage.deleteMany({});
  await prisma.sessionSchedule.deleteMany({});
  await prisma.packageDefinition.deleteMany({});
  await prisma.equipment.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.memberProfile.deleteMany({});
  await prisma.trainerProfile.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.studio.deleteMany({});

  // 1. Create Studios
  const studioA = await prisma.studio.create({
    data: {
      name: 'Zen Reformer Pilates Studio',
      slug: 'zen-pilates',
      phone: '+90 532 111 2233',
      email: 'info@zenpilates.com',
      address: 'Nişantaşı Mah. Abdi İpekçi Cad. No:14/A Şişli / İstanbul',
      primaryColor: '#0f172a',
      secondaryColor: '#0ea5e9',
      cancellationDeadlineHours: 4,
      reminderHoursBefore: 2,
      maxAdvanceBookingDays: 14,
    },
  });

  const studioB = await prisma.studio.create({
    data: {
      name: 'Flow Boutique Pilates & Wellness',
      slug: 'flow-pilates',
      phone: '+90 533 444 5566',
      email: 'merhaba@flowpilates.com',
      address: 'Bağdat Caddesi No:240/3 Kadıköy / İstanbul',
      primaryColor: '#1e1b4b',
      secondaryColor: '#ec4899',
      cancellationDeadlineHours: 6,
      reminderHoursBefore: 3,
      maxAdvanceBookingDays: 21,
    },
  });

  console.log(`Studios created: ${studioA.name} & ${studioB.name}`);

  // 2. Create Branches & Rooms for Studio A
  const branchA = await prisma.branch.create({
    data: {
      studioId: studioA.id,
      name: 'Nişantaşı Merkez Şube',
      address: studioA.address,
      phone: studioA.phone,
    },
  });

  const roomA1 = await prisma.room.create({
    data: {
      studioId: studioA.id,
      branchId: branchA.id,
      name: 'Birebir Reformer Stüdyosu 1',
      capacity: 1,
    },
  });

  const roomA2 = await prisma.room.create({
    data: {
      studioId: studioA.id,
      branchId: branchA.id,
      name: 'Grup & Düet Reformer Salonu',
      capacity: 4,
    },
  });

  // Equipments
  await prisma.equipment.createMany({
    data: [
      { studioId: studioA.id, roomId: roomA1.id, name: 'Reformer & Tower Combo #1', serialNumber: 'BAL-2024-001' },
      { studioId: studioA.id, roomId: roomA2.id, name: 'Reformer Yatak #A', serialNumber: 'REF-A-01' },
      { studioId: studioA.id, roomId: roomA2.id, name: 'Reformer Yatak #B', serialNumber: 'REF-A-02' },
      { studioId: studioA.id, roomId: roomA2.id, name: 'Reformer Yatak #C', serialNumber: 'REF-A-03' },
      { studioId: studioA.id, roomId: roomA2.id, name: 'Reformer Yatak #D', serialNumber: 'REF-A-04' },
    ],
  });

  // 3. Create Package Definitions
  const pkgA10 = await prisma.packageDefinition.create({
    data: {
      studioId: studioA.id,
      name: '10 Seans Birebir Özel Reformer',
      sessionType: SessionType.PRIVATE_REFORMER,
      totalSessions: 10,
      validityDays: 60,
      price: 12000.00,
      freezeDaysAllowed: 15,
    },
  });

  const pkgA20 = await prisma.packageDefinition.create({
    data: {
      studioId: studioA.id,
      name: '20 Seans Birebir Özel Reformer',
      sessionType: SessionType.PRIVATE_REFORMER,
      totalSessions: 20,
      validityDays: 100,
      price: 22000.00,
      freezeDaysAllowed: 30,
    },
  });

  const pkgAGroup = await prisma.packageDefinition.create({
    data: {
      studioId: studioA.id,
      name: '12 Seans Grup Reformer (4 Kişilik)',
      sessionType: SessionType.GROUP_REFORMER,
      totalSessions: 12,
      validityDays: 60,
      price: 8400.00,
      freezeDaysAllowed: 10,
    },
  });

  // 4. Create Studio Admins & Staff
  const adminA = await prisma.user.create({
    data: {
      studioId: studioA.id,
      firstName: 'Elif',
      lastName: 'Yılmaz',
      phone: '05551112233',
      email: 'elif@zenpilates.com',
      passwordHash: '$2b$10$ep/0tW2gR.U95zWw5L4QY.W5aUqW5Q5R.Z7hM2K9p8N1PqX9R5kQ2', // hash of "admin123"
      role: Role.STUDIO_ADMIN,
    },
  });

  // Trainer for Studio A
  const trainerUserA = await prisma.user.create({
    data: {
      studioId: studioA.id,
      firstName: 'Selin',
      lastName: 'Aydın',
      phone: '05552223344',
      email: 'selin@zenpilates.com',
      passwordHash: '$2b$10$ep/0tW2gR.U95zWw5L4QY.W5aUqW5Q5R.Z7hM2K9p8N1PqX9R5kQ2',
      role: Role.TRAINER,
    },
  });

  const trainerProfileA = await prisma.trainerProfile.create({
    data: {
      userId: trainerUserA.id,
      studioId: studioA.id,
      bio: 'Uluslararası Pilates Federasyonu 3. Kademe Eğitmeni. Postür düzeltme ve hamile pilatesi uzmanı.',
      specialties: [SessionType.PRIVATE_REFORMER, SessionType.CADILLAC_PILATES, SessionType.CLINICAL_PILATES],
      commissionType: CommissionType.PER_SESSION_FIXED,
      commissionValue: 350.00,
    },
  });

  // 5. Create Sample Member
  const memberUserA = await prisma.user.create({
    data: {
      studioId: studioA.id,
      firstName: 'Ayşe',
      lastName: 'Demir',
      phone: '05553334455',
      email: 'ayse.demir@example.com',
      passwordHash: '$2b$10$ep/0tW2gR.U95zWw5L4QY.W5aUqW5Q5R.Z7hM2K9p8N1PqX9R5kQ2',
      role: Role.MEMBER,
    },
  });

  const memberProfileA = await prisma.memberProfile.create({
    data: {
      userId: memberUserA.id,
      studioId: studioA.id,
      birthDate: new Date('1992-05-14'),
      emergencyContactName: 'Mehmet Demir (Eşi)',
      emergencyContactPhone: '05559998877',
      medicalConditions: 'L4-L5 Bel fıtığı başlangıcı var. Ağır rotasyon hareketlerinden kaçınılmalı.',
      notes: 'Haftada 2 gün sabah 09:00 saatlerini tercih ediyor.',
      hasSignedWaiver: true,
    },
  });

  // Assign 10 session package to Ayşe
  const memberPackageA = await prisma.memberPackage.create({
    data: {
      studioId: studioA.id,
      memberId: memberProfileA.id,
      packageDefinitionId: pkgA10.id,
      sessionType: SessionType.PRIVATE_REFORMER,
      totalSessions: 10,
      usedSessions: 2,
      remainingSessions: 8,
      status: PackageStatus.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  });

  // Log Payment
  await prisma.payment.create({
    data: {
      studioId: studioA.id,
      memberId: memberProfileA.id,
      memberPackageId: memberPackageA.id,
      amount: 12000.00,
      paymentMethod: PaymentMethod.CREDIT_CARD_POS,
      receiptNumber: 'POS-2024-00452',
      notes: 'Tek çekim tahsil edildi',
    },
  });

  // 6. Create Today's Session Schedule & Booking
  const todayMorning = new Date();
  todayMorning.setHours(10, 0, 0, 0);
  const todayEnd = new Date(todayMorning);
  todayEnd.setHours(11, 0, 0, 0);

  const schedule1 = await prisma.sessionSchedule.create({
    data: {
      studioId: studioA.id,
      branchId: branchA.id,
      roomId: roomA1.id,
      trainerId: trainerProfileA.id,
      sessionType: SessionType.PRIVATE_REFORMER,
      title: 'Birebir Klinik Reformer',
      startTime: todayMorning,
      endTime: todayEnd,
      capacity: 1,
      bookedCount: 1,
    },
  });

  await prisma.booking.create({
    data: {
      studioId: studioA.id,
      scheduleId: schedule1.id,
      memberId: memberProfileA.id,
      memberPackageId: memberPackageA.id,
      status: BookingStatus.CONFIRMED,
    },
  });

  console.log('Seed completed successfully!');
  console.log('Credentials:');
  console.log('   Admin (Zen Pilates):  elif@zenpilates.com / admin123');
  console.log('   Trainer (Selin):      selin@zenpilates.com / admin123');
  console.log('   Member (Ayşe Demir):  ayse.demir@example.com / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
