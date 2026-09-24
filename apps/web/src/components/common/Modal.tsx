'use client';

import { X } from 'lucide-react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        style={{ borderRadius: 'var(--radius-card)', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h3>
          <button onClick={onClose} className="p-1" style={{ color: 'var(--color-text-muted)' }} aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
