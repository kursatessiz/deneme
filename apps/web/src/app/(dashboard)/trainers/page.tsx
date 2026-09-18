'use client';

import { useState } from 'react';
import { UserCheck, DollarSign, Calendar, Award, Phone } from 'lucide-react';

export default function TrainersPage() {
  const [trainers] = useState([
    {
      id: 't1',
      name: 'Selin Aydın',
      phone: '0555 222 33 44',
      email: 'selin@zenpilates.com',
      specialty: 'Klinik Reformer & Hamile Pilatesi',
      commissionType: 'Seans Başı Sabit Ücret',
      commissionRate: '350 ₺ / seans',
      sessionsThisMonth: 38,
      totalEarned: '13.300 ₺',
    },
    {
      id: 't2',
      name: 'Burak Kaya',
      phone: '0533 888 77 66',
      email: 'burak@zenpilates.com',
      specialty: 'Cadillac & Sporcu Kondisyon',
      commissionType: 'Seans Başı Sabit Ücret',
      commissionRate: '350 ₺ / seans',
      sessionsThisMonth: 29,
      totalEarned: '10.150 ₺',
    },
    {
      id: 't3',
      name: 'Ezgi Doğan',
      phone: '0542 555 66 77',
      email: 'ezgi@zenpilates.com',
      specialty: 'Grup Reformer & Mat Pilates',
      commissionType: 'Ders Başı Sabit Ücret',
      commissionRate: '300 ₺ / seans',
      sessionsThisMonth: 22,
      totalEarned: '6.600 ₺',
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Eğitmenler ve Hakediş Takibi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Eğitmen profilleri, tamamlanan seanslar ve aylık hakediş bordrosu
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-sky-500" />
          Dönem: Eylül 2026
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {trainers.map((t) => (
          <div
            key={t.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-base text-slate-700 dark:text-slate-300">
                  {t.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">{t.name}</h3>
                  <span className="text-xs text-slate-500 flex items-center mt-0.5">
                    <Phone className="w-3 h-3 mr-1" /> {t.phone}
                  </span>
                </div>
              </div>

              <div className="text-xs text-sky-600 dark:text-sky-400 font-medium bg-sky-50 dark:bg-sky-950/40 p-2.5 rounded-lg mb-4 flex items-center">
                <Award className="w-4 h-4 mr-1.5 shrink-0" />
                {t.specialty}
              </div>

              <div className="space-y-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-3">
                <div className="flex justify-between text-slate-500">
                  <span>Ücret Modeli:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t.commissionType}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Birim Ücret:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t.commissionRate}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Bu Ay Girilen Seans:</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">{t.sessionsThisMonth} Seans</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">Bu Ayki Hakediş</span>
                <span className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {t.totalEarned}
                </span>
              </div>

              <button className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 transition">
                Seans Listesi &rarr;
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
