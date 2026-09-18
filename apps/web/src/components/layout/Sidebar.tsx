'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar,
  Users,
  Package,
  UserCheck,
  TrendingUp,
  Settings,
  Sparkles,
  Layers,
} from 'lucide-react';

const navigation = [
  { name: 'Genel Bakış', href: '/dashboard', icon: TrendingUp },
  { name: 'Ders Takvimi', href: '/calendar', icon: Calendar },
  { name: 'Üyeler & Paketler', href: '/members', icon: Users },
  { name: 'Paket Tanımları', href: '/packages', icon: Package },
  { name: 'Eğitmenler & Hakediş', href: '/trainers', icon: UserCheck },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col shrink-0 min-h-screen border-r border-slate-800">
      {/* Studio Brand Header */}
      <div className="p-6 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-sky-500/20">
            P
          </div>
          <div>
            <h1 className="font-semibold text-white tracking-tight">Pilates Studio</h1>
            <p className="text-xs text-sky-400 font-medium">Yönetim Paneli</p>
          </div>
        </div>
      </div>

      {/* Studio Tenant Switcher */}
      <div className="px-4 py-3 bg-slate-950/60 mx-3 my-4 rounded-xl border border-slate-800/80">
        <label className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase block mb-1">
          Aktif Stüdyo
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">Zen Pilates (Nişantaşı)</span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20"></span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30 font-semibold'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>v1.0 • Ubuntu 24.04</span>
        </div>
        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-emerald-400">Canlı</span>
      </div>
    </aside>
  );
}
