'use client';

import { Bell, Search, User, Calendar as CalendarIcon } from 'lucide-react';

export function Header() {
  const today = new Date().toLocaleDateString('tr-TR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center space-x-3 text-sm text-slate-500 dark:text-slate-400">
        <CalendarIcon className="w-4 h-4 text-sky-500" />
        <span className="font-medium text-slate-700 dark:text-slate-200 capitalize">{today}</span>
      </div>

      <div className="flex items-center space-x-4">
        {/* Search Bar */}
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Üye adı veya telefon..."
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
          />
        </div>

        {/* Notifications */}
        <button
          title="Bildirimler"
          aria-label="Bildirimler"
          className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
        </button>

        {/* User Profile Avatar */}
        <div className="flex items-center space-x-3 pl-3 border-l border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-medium text-sm text-slate-700 dark:text-slate-200">
            EY
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Elif Yılmaz</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Stüdyo Yöneticisi</p>
          </div>
        </div>
      </div>
    </header>
  );
}
