'use client';

import { useState } from 'react';
import {
  Search,
  UserPlus,
  HeartPulse,
  Package,
  Clock,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
  Phone,
} from 'lucide-react';

export default function MembersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New member form state
  const [newMember, setNewMember] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    medicalConditions: '',
  });

  const [members, setMembers] = useState([
    {
      id: 'm1',
      name: 'Ayşe Demir',
      phone: '0555 333 44 55',
      email: 'ayse.demir@example.com',
      packageName: '10 Seans Birebir Özel Reformer',
      remaining: 8,
      total: 10,
      endDate: '15 Kasım 2026',
      status: 'ACTIVE',
      medicalNote: 'L4-L5 Bel Fıtığı başlangıcı',
      hasWaiver: true,
    },
    {
      id: 'm2',
      name: 'Merve Korkmaz',
      phone: '0532 999 11 22',
      email: 'merve@example.com',
      packageName: '8 Seans Düet Reformer',
      remaining: 4,
      total: 8,
      endDate: '28 Ekim 2026',
      status: 'ACTIVE',
      medicalNote: null,
      hasWaiver: true,
    },
    {
      id: 'm3',
      name: 'Deniz Şen',
      phone: '0544 222 33 44',
      email: 'deniz.sen@example.com',
      packageName: '20 Seans Birebir Özel Reformer',
      remaining: 2,
      total: 20,
      endDate: '24 Eylül 2026',
      status: 'ACTIVE',
      medicalNote: 'Boyun düzleşmesi (Servikal Lordoz)',
      hasWaiver: true,
    },
    {
      id: 'm4',
      name: 'Canan Arslan',
      phone: '0533 111 22 88',
      email: 'canan@example.com',
      packageName: '12 Seans Grup Reformer',
      remaining: 0,
      total: 12,
      endDate: '10 Eylül 2026',
      status: 'DEPLETED',
      medicalNote: 'Skolyoz (12 derece torakal)',
      hasWaiver: true,
    },
  ]);

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.firstName || !newMember.phone) return;

    setMembers([
      {
        id: `m-${Date.now()}`,
        name: `${newMember.firstName} ${newMember.lastName}`,
        phone: newMember.phone,
        email: newMember.email || '-',
        packageName: 'Paket Bekleniyor',
        remaining: 0,
        total: 0,
        endDate: '-',
        status: 'ACTIVE',
        medicalNote: newMember.medicalConditions || null,
        hasWaiver: false,
      },
      ...members,
    ]);

    setNewMember({ firstName: '', lastName: '', phone: '', email: '', medicalConditions: '' });
    setIsModalOpen(false);
  };

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.phone.includes(searchTerm),
  );

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Üyeler ve Paket Durumları
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Stüdyo üyeleri, kalan seans kredileri ve sağlık notları
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white shadow-sm transition"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Yeni Üye Kaydet
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="İsim veya telefon ile ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>

        <div className="text-xs text-slate-500">
          Toplam <strong>{members.length}</strong> üye listeleniyor
        </div>
      </div>

      {/* Members Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-6 py-3.5">Üye Bilgisi</th>
                <th className="px-6 py-3.5">Aktif Paket</th>
                <th className="px-6 py-3.5">Kalan Kredi</th>
                <th className="px-6 py-3.5">Sağlık / Fıtık Notu</th>
                <th className="px-6 py-3.5">Son Kullanım</th>
                <th className="px-6 py-3.5 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition">
                  {/* Name & Phone */}
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {member.name}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center mt-0.5">
                      <Phone className="w-3 h-3 mr-1" /> {member.phone}
                    </div>
                  </td>

                  {/* Package */}
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-1.5">
                      <Package className="w-4 h-4 text-sky-500 shrink-0" />
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {member.packageName}
                      </span>
                    </div>
                  </td>

                  {/* Remaining Credits */}
                  <td className="px-6 py-4">
                    {member.total > 0 ? (
                      <div className="flex items-center space-x-2">
                        <span
                          className={`font-bold text-sm ${
                            member.remaining <= 2
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {member.remaining} / {member.total}
                        </span>
                        <span className="text-xs text-slate-400">seans</span>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-500 font-medium">Paketsiz</span>
                    )}
                  </td>

                  {/* Medical Condition Alert */}
                  <td className="px-6 py-4">
                    {member.medicalNote ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50">
                        <HeartPulse className="w-3.5 h-3.5 mr-1" />
                        {member.medicalNote}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Belirtilmedi</span>
                    )}
                  </td>

                  {/* Validity Date */}
                  <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">
                    {member.endDate}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 transition">
                        Paket Yükle
                      </button>
                      <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Member Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
              Yeni Pilates Üyesi Kaydet
            </h3>

            <form onSubmit={handleAddMember} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Ad *
                  </label>
                  <input
                    type="text"
                    required
                    value={newMember.firstName}
                    onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Soyad *
                  </label>
                  <input
                    type="text"
                    required
                    value={newMember.lastName}
                    onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Telefon Numarası *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="05xxxxxxxxx"
                  value={newMember.phone}
                  onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  E-Posta (İsteğe Bağlı)
                </label>
                <input
                  type="email"
                  value={newMember.email}
                  onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Sağlık Notu (Fıtık, Skolyoz, vb.)
                </label>
                <textarea
                  rows={2}
                  placeholder="Örn: L4-L5 Bel Fıtığı başlangıcı, ağır döndürme hareketleri yasak"
                  value={newMember.medicalConditions}
                  onChange={(e) => setNewMember({ ...newMember, medicalConditions: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-sky-500 hover:bg-sky-600 text-white"
                >
                  Kaydı Tamamla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
