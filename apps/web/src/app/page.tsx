'use client';

import Link from 'next/link';
import { Sparkles, ArrowRight, ShieldCheck, Activity, Calendar, Users } from 'lucide-react';

export default function RootLandingPage() {
  const studios = [
    {
      id: 's1',
      name: 'Zen Reformer Pilates',
      slug: 'zen-pilates',
      branch: 'Nişantaşı / İstanbul',
      activeMembers: 64,
      trainers: 3,
      themeColor: 'from-sky-500 to-indigo-600',
      tag: 'Kız Kardeşimin Stüdyosu',
    },
    {
      id: 's2',
      name: 'Flow Boutique Pilates & Wellness',
      slug: 'flow-pilates',
      branch: 'Bağdat Caddesi / Kadıköy',
      activeMembers: 52,
      trainers: 3,
      themeColor: 'from-pink-500 to-rose-600',
      tag: 'Kardeşimin Eşinin Stüdyosu',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6 md:p-12">
      {/* Top Brand */}
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg">
            P
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight">Platform</span>
            <span className="text-xs text-sky-400 block font-medium">Çoklu İşletme Randevu ve Üyelik Portalı</span>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Ubuntu 24.04 Production Ready</span>
        </div>
      </div>

      {/* Main Hero & Studio Selector */}
      <div className="max-w-4xl mx-auto w-full my-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-sky-400 mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Stüdyo Seçimi ve Hızlı Giriş</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white max-w-2xl mx-auto leading-tight">
          Üyelik ve Randevu Tabanlı İşletmeler İçin Yönetim Platformu
        </h1>
        <p className="text-slate-400 text-base max-w-xl mx-auto mt-4">
          Stüdyolar, kişisel antrenörler, fizyoterapi klinikleri, yoga merkezleri, spor sahaları ve kurslar için randevu takvimi, kalan seans kredisi takibi, personel hakedişleri ve üye geçmişini tek platformdan yönetin.
        </p>

        {/* 2 Studio Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12 text-left">
          {studios.map((s) => (
            <div
              key={s.id}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition shadow-xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {s.tag}
                  </span>
                  <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${s.themeColor}`}></div>
                </div>

                <h3 className="text-xl font-bold text-white">{s.name}</h3>
                <p className="text-xs text-slate-400 mt-1">{s.branch}</p>

                <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-slate-800 text-xs">
                  <div className="flex items-center space-x-2 text-slate-300">
                    <Users className="w-4 h-4 text-sky-400" />
                    <span>{s.activeMembers} Aktif Üye</span>
                  </div>
                  <div className="flex items-center space-x-2 text-slate-300">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    <span>{s.trainers} Eğitmen</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="flex-1 text-center py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs transition flex items-center justify-center"
                >
                  Yönetici Paneline Gir <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Link>
                <Link
                  href={`/${s.slug}/book`}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition"
                >
                  Üye Rezervasyonu
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer System Status */}
      <div className="max-w-5xl mx-auto w-full text-center text-xs text-slate-500 border-t border-slate-900 pt-6">
        <span>Platform • NestJS API • Next.js 15 Standalone • Caddy Reverse Proxy • 6GB RAM Tuned</span>
      </div>
    </div>
  );
}
