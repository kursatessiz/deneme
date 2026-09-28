'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, Clock, User, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function PublicBookingPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [selectedType, setSelectedType] = useState('Birebir Özel Reformer');
  const [selectedDate, setSelectedDate] = useState('Bugün (18 Eylül)');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);

  const studioName =
    slug === 'flow-pilates'
      ? 'Flow Boutique Pilates & Wellness'
      : 'Zen Reformer Pilates';

  const availableSlots = [
    { time: '11:00 - 12:00', trainer: 'Selin Aydın' },
    { time: '15:00 - 16:00', trainer: 'Burak Kaya' },
    { time: '17:00 - 18:00', trainer: 'Selin Aydın' },
  ];

  const handleBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot) return;
    setIsConfirmed(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xl">
        <Link
          href="/"
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Stüdyo Listesine Dön
        </Link>

        {isConfirmed ? (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              Rezervasyon Onaylandı!
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <strong>{selectedType}</strong> seansınız {selectedDate} günü saat <strong>{selectedSlot}</strong> için oluşturuldu. Kalan seansınızdan 1 kredi düşüldü.
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60">
              Not: İptal işlemleri seans saatine en geç 4 saat kala ücretsiz olarak yapılabilir.
            </p>
            <button
              onClick={() => setIsConfirmed(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold mt-4"
            >
              Yeni Bir Randevu Al
            </button>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-500 bg-sky-50 dark:bg-sky-950/60 px-3 py-1 rounded-full border border-sky-200 dark:border-sky-900/60">
                Online Rezervasyon
              </span>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-3">
                {studioName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Lütfen seans türünü ve uygun saatinizi belirleyin
              </p>
            </div>

            <form onSubmit={handleBooking} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Ders Türü
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="Birebir Özel Reformer">Birebir Özel Reformer (1 Seans)</option>
                  <option value="Düet Reformer">Düet Reformer (2 Kişi)</option>
                  <option value="Cadillac Trapeze Özel">Cadillac Trapeze Özel</option>
                  <option value="Grup Reformer">Grup Reformer</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Tarih Seçimi
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {['Bugün (18 Eylül)', 'Yarın (19 Eylül)'].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDate(d)}
                      className={`p-2 rounded-xl border text-center font-medium transition ${
                        selectedDate === d
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Müsait Seans Saatleri
                </label>
                <div className="space-y-2">
                  {availableSlots.map((s) => (
                    <label
                      key={s.time}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                        selectedSlot === s.time
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name="timeSlot"
                          checked={selectedSlot === s.time}
                          onChange={() => setSelectedSlot(s.time)}
                          className="text-sky-500"
                        />
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {s.time}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 flex items-center">
                        <User className="w-3 h-3 mr-1" /> {s.trainer}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedSlot}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs transition shadow-md mt-6"
              >
                Randevuyu Onayla
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
