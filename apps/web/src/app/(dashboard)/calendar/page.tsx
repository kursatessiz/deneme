'use client';

import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  User,
  MapPin,
  Clock,
  Check,
  X,
} from 'lucide-react';

const timeSlots = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'
];

const mockRooms = [
  { id: 'r1', name: 'Reformer Odası 1 (Birebir)', capacity: 1 },
  { id: 'r2', name: 'Cadillac Trapeze', capacity: 1 },
  { id: 'r3', name: 'Grup & Düet Salonu', capacity: 4 },
];

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState('18 Eylül 2026, Cuma');
  const [selectedRoom, setSelectedRoom] = useState('all');

  const [events, setEvents] = useState([
    {
      id: 'e1',
      title: 'Klinik Reformer (Birebir)',
      time: '09:00 - 10:00',
      slot: '09:00',
      room: 'Reformer Odası 1 (Birebir)',
      trainer: 'Selin Aydın',
      member: 'Ayşe Demir',
      capacity: 1,
      booked: 1,
      color: 'border-l-sky-500 bg-sky-50/70 dark:bg-sky-950/30 text-sky-900 dark:text-sky-200',
    },
    {
      id: 'e2',
      title: 'Düet Reformer',
      time: '10:00 - 11:00',
      slot: '10:00',
      room: 'Grup & Düet Salonu',
      trainer: 'Selin Aydın',
      member: 'Merve K. & Zeynep T.',
      capacity: 2,
      booked: 2,
      color: 'border-l-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200',
    },
    {
      id: 'e3',
      title: 'Cadillac Trapeze Özel',
      time: '14:00 - 15:00',
      slot: '14:00',
      room: 'Cadillac Trapeze',
      trainer: 'Burak Kaya',
      member: 'Deniz Şen',
      capacity: 1,
      booked: 1,
      color: 'border-l-purple-500 bg-purple-50/70 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200',
    },
    {
      id: 'e4',
      title: 'Grup Reformer (Seviye 1)',
      time: '18:00 - 19:00',
      slot: '18:00',
      room: 'Grup & Düet Salonu',
      trainer: 'Selin Aydın',
      member: 'Grup Dersi (3/4)',
      capacity: 4,
      booked: 3,
      color: 'border-l-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
    },
  ]);

  return (
    <div className="space-y-6">
      {/* Calendar Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Ders & Seans Takvimi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Reformer yatakları ve eğitmen bazlı randevu planlama
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Room Filter */}
          <select
            value={selectedRoom}
            onChange={(e) => setSelectedRoom(e.target.value)}
            className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
          >
            <option value="all">Tüm Odalar & Ekipmanlar</option>
            {mockRooms.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>

          <button className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white shadow-sm transition">
            <Plus className="w-4 h-4 mr-2" />
            Yeni Seans Aç
          </button>
        </div>
      </div>

      {/* Date Navigator */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-3">
          <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedDate}</span>
          <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="inline-flex items-center px-2 py-1 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-sky-500 mr-1.5"></span> Birebir Reformer
          </span>
          <span className="inline-flex items-center px-2 py-1 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-indigo-500 mr-1.5"></span> Düet Reformer
          </span>
          <span className="inline-flex items-center px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5"></span> Grup Seansı
          </span>
        </div>
      </div>

      {/* Daily Time Grid */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {timeSlots.map((slot) => {
            const slotEvents = events.filter((e) => e.slot === slot);

            return (
              <div key={slot} className="flex min-h-[90px] group hover:bg-slate-50/40 dark:hover:bg-slate-800/20 transition">
                {/* Time Label */}
                <div className="w-24 p-4 text-xs font-semibold text-slate-400 border-r border-slate-100 dark:border-slate-800 shrink-0">
                  {slot}
                </div>

                {/* Event Slot Area */}
                <div className="flex-1 p-3 flex flex-wrap gap-3 items-center">
                  {slotEvents.length > 0 ? (
                    slotEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className={`border-l-4 p-3 rounded-lg flex-1 min-w-[280px] max-w-lg border shadow-xs ${evt.color}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{evt.title}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-900/60">
                            {evt.booked} / {evt.capacity} Kontenjan
                          </span>
                        </div>

                        <p className="text-xs font-medium mt-1">
                          Üye: <span className="font-semibold">{evt.member}</span>
                        </p>

                        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                          <span className="flex items-center">
                            <Clock className="w-3 h-3 mr-1" /> {evt.time}
                          </span>
                          <span className="flex items-center">
                            <User className="w-3 h-3 mr-1" /> {evt.trainer}
                          </span>
                          <span className="flex items-center">
                            <MapPin className="w-3 h-3 mr-1" /> {evt.room}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-300 dark:text-slate-700 italic group-hover:text-slate-400 transition cursor-pointer flex items-center">
                      <Plus className="w-3 h-3 mr-1 opacity-0 group-hover:opacity-100 transition" />
                      Boş Seans (Tıkla ve Randevu Oluştur)
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
