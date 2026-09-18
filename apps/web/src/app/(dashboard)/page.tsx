'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Users,
  CreditCard,
  AlertTriangle,
  Clock,
  Plus,
  CheckCircle2,
  ArrowUpRight,
  Activity,
  HeartPulse,
} from 'lucide-react';

export default function DashboardPage() {
  // Sample state (connects to GET /api/studios/:studioId/metrics in production)
  const [metrics] = useState({
    todaySessions: 6,
    todayAttendees: 9,
    occupancyRate: 88,
    monthlyRevenue: '124.500 ₺',
    expiringPackages: 3,
  });

  const [todaySchedule, setTodaySchedule] = useState([
    {
      id: '1',
      time: '09:00 - 10:00',
      title: 'Birebir Klinik Reformer',
      trainer: 'Selin Aydın',
      member: 'Ayşe Demir',
      phone: '0555 333 44 55',
      room: 'Reformer Odası 1',
      status: 'CONFIRMED',
      hasHealthAlert: true,
      healthNote: 'L4-L5 Bel Fıtığı başlangıcı. Ağır torsiyonlardan kaçınılmalı.',
      remainingSessions: 8,
    },
    {
      id: '2',
      time: '10:30 - 11:30',
      title: 'Düet Reformer (2 Kişi)',
      trainer: 'Selin Aydın',
      member: 'Merve Korkmaz & Zeynep Tan',
      phone: '0532 999 11 22',
      room: 'Grup Salonu',
      status: 'CONFIRMED',
      hasHealthAlert: false,
      remainingSessions: 4,
    },
    {
      id: '3',
      time: '14:00 - 15:00',
      title: 'Cadillac Trapeze Özel',
      trainer: 'Burak Kaya',
      member: 'Deniz Şen',
      phone: '0544 222 33 44',
      room: 'Cadillac Stüdyosu',
      status: 'ATTENDED',
      hasHealthAlert: true,
      healthNote: 'Boyun düzleşmesi. Baş-boyun desteği kullanılmalı.',
      remainingSessions: 2,
    },
    {
      id: '4',
      time: '17:00 - 18:00',
      title: 'Grup Reformer (4 Kişi)',
      trainer: 'Selin Aydın',
      member: '4 Kayıtlı Katılımcı (Kontenjan Dolu)',
      phone: 'Çoklu Üye',
      room: 'Grup Salonu',
      status: 'CONFIRMED',
      hasHealthAlert: false,
      remainingSessions: 6,
    },
  ]);

  const handleCheckIn = (id: string) => {
    setTodaySchedule((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'ATTENDED' } : s)),
    );
  };

  return (
    <div className="space-y-8">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Bugünün Stüdyo Durumu
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Zen Reformer Pilates • Nişantaşı Şubesi günlük operasyon akışı
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/calendar"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white shadow-sm shadow-sky-500/20 transition"
          >
            <Plus className="w-4 h-4 mr-2" />
            Yeni Randevu Oluştur
          </Link>
          <Link
            href="/members"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition"
          >
            Üye Ekle
          </Link>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Bugünkü Seans</span>
            <Calendar className="w-4 h-4 text-sky-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            {metrics.todaySessions} <span className="text-sm font-normal text-slate-400">Ders</span>
          </p>
          <span className="text-xs text-emerald-500 font-medium flex items-center mt-2">
            <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> 2 seans tamamlandı
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Katılacak Üye</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            {metrics.todayAttendees} <span className="text-sm font-normal text-slate-400">Kişi</span>
          </p>
          <span className="text-xs text-slate-400 font-medium flex items-center mt-2">
            Reformer yatakları dolu
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Doluluk Oranı</span>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            %{metrics.occupancyRate}
          </p>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${metrics.occupancyRate}%` }}></div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Aylık Tahsilat</span>
            <CreditCard className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-slate-900 dark:text-white">
            {metrics.monthlyRevenue}
          </p>
          <span className="text-xs text-emerald-500 font-medium flex items-center mt-2">
            Bu ay 18 paket satıldı
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Kritik Paketler</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold mt-2 text-rose-600 dark:text-rose-400">
            {metrics.expiringPackages} <span className="text-sm font-normal text-slate-400">Üye</span>
          </p>
          <span className="text-xs text-rose-500/80 font-medium flex items-center mt-2">
            ≤ 2 seansı kaldı (Yenileme)
          </span>
        </div>
      </div>

      {/* Main Content: Today's Class Timeline & Health Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Today's Schedule Timeline */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-sky-500" />
              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                Bugünkü Ders Programı & Check-In
              </h3>
            </div>
            <Link
              href="/calendar"
              className="text-xs font-semibold text-sky-500 hover:text-sky-600 flex items-center"
            >
              Haftalık Takvimi Aç &rarr;
            </Link>
          </div>

          <div className="space-y-4">
            {todaySchedule.map((session) => (
              <div
                key={session.id}
                className={`p-4 rounded-xl border transition-all ${
                  session.status === 'ATTENDED'
                    ? 'border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {session.time}
                      </span>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {session.room}
                      </span>
                    </div>

                    <h4 className="text-base font-semibold text-slate-900 dark:text-white mt-2">
                      {session.title}
                    </h4>

                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{session.member}</span>
                      <span className="mx-2 text-slate-400">•</span>
                      <span className="text-xs text-slate-500">Eğitmen: {session.trainer}</span>
                      <span className="mx-2 text-slate-400">•</span>
                      <span className="text-xs text-sky-600 dark:text-sky-400">
                        Kalan: {session.remainingSessions} seans
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {session.status === 'ATTENDED' ? (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        Katıldı (Düştü)
                      </span>
                    ) : (
                      <button
                        onClick={() => handleCheckIn(session.id)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 transition shadow-sm"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-sky-400" />
                        Giriş Yap (Check-In)
                      </button>
                    )}
                  </div>
                </div>

                {/* Health Warning Banner if Member has Medical History */}
                {session.hasHealthAlert && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-start space-x-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-500/5 p-2 rounded-lg">
                    <HeartPulse className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Eğitmen Dikkatine:</strong> {session.healthNote}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right 1 Col: Quick Actions & Renewal Alerts */}
        <div className="space-y-6">
          {/* Action Center */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
              Hızlı Yönetim Araçları
            </h3>

            <div className="space-y-2.5">
              <Link
                href="/calendar"
                className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-500 flex items-center justify-center">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Reformer Yatak Takvimi
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-sky-500 transition" />
              </Link>

              <Link
                href="/members"
                className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Üye & Paket Tanımla
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition" />
              </Link>

              <Link
                href="/trainers"
                className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Eğitmen Hakediş Raporu
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition" />
              </Link>
            </div>
          </div>

          {/* SMS & Notification Center */}
          <div className="bg-gradient-to-br from-slate-900 to-indigo-950 border border-indigo-800/40 text-white rounded-2xl p-6 shadow-md">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60">
              Otomasyon Aktif
            </span>
            <h4 className="font-semibold text-lg mt-3">SMS & Hatırlatıcı Servisi</h4>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              Ders saatine 2 saat kala üyelere otomatik seans hatırlatması gönderilir. İptal süresi kuralı: 4 saat.
            </p>
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>Bugün Gönderilen: 12 SMS</span>
              <span className="text-emerald-400 font-medium">Netgsm Aktif</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
