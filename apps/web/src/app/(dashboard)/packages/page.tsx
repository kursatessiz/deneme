'use client';

import { useState } from 'react';
import { Package, Plus, Check, Clock, Calendar, ShieldAlert } from 'lucide-react';

export default function PackagesPage() {
  const [packages] = useState([
    {
      id: 'p1',
      name: '10 Seans Birebir Özel Reformer',
      sessionType: 'Birebir (1-e-1)',
      totalSessions: 10,
      validityDays: 60,
      price: '12.000 ₺',
      freezeDays: 15,
      activeSalesCount: 14,
    },
    {
      id: 'p2',
      name: '20 Seans Birebir Özel Reformer (Avantajlı)',
      sessionType: 'Birebir (1-e-1)',
      totalSessions: 20,
      validityDays: 100,
      price: '22.000 ₺',
      freezeDays: 30,
      activeSalesCount: 9,
    },
    {
      id: 'p3',
      name: '8 Seans Düet Reformer (2 Kişi)',
      sessionType: 'Düet Reformer',
      totalSessions: 8,
      validityDays: 45,
      price: '9.600 ₺',
      freezeDays: 10,
      activeSalesCount: 6,
    },
    {
      id: 'p4',
      name: '12 Seans Grup Reformer (4 Kişilik)',
      sessionType: 'Grup Dersi',
      totalSessions: 12,
      validityDays: 60,
      price: '8.400 ₺',
      freezeDays: 15,
      activeSalesCount: 18,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Paket ve Fiyat Tanımları
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Stüdyoda satılan seans paketleri, geçerlilik süreleri ve dondurma politikaları
          </p>
        </div>

        <button className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white shadow-sm transition">
          <Plus className="w-4 h-4 mr-2" />
          Yeni Paket Tanımla
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition"
          >
            <div>
              <div className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 mb-3">
                {pkg.sessionType}
              </div>

              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {pkg.name}
              </h3>

              <div className="mt-4 mb-6">
                <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                  {pkg.price}
                </span>
                <span className="text-xs text-slate-400 block mt-1">
                  ({Math.round(parseInt(pkg.price.replace(/\D/g, '')) / pkg.totalSessions)} ₺ / seans)
                </span>
              </div>

              <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center text-slate-500">
                    <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    Toplam Seans:
                  </span>
                  <span className="font-semibold">{pkg.totalSessions} Seans</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center text-slate-500">
                    <Calendar className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    Geçerlilik Süresi:
                  </span>
                  <span className="font-semibold">{pkg.validityDays} Gün</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center text-slate-500">
                    <ShieldAlert className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
                    Dondurma İzni:
                  </span>
                  <span className="font-semibold">{pkg.freezeDays} Gün</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Aktif {pkg.activeSalesCount} Üyede Var</span>
              <button className="font-semibold text-sky-500 hover:text-sky-600">
                Düzenle
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
