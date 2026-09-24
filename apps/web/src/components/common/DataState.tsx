import { Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Yükleniyor...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 gap-2" style={{ color: 'var(--color-text-muted)' }}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-20 rounded-2xl border"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      {description && (
        <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {description}
        </p>
      )}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border py-10 px-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-danger, #b42318)' }}>
      {message}
    </div>
  );
}
