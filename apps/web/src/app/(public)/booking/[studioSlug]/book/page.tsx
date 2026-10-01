'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { User, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useT } from '@/components/i18n/I18nProvider';
import { Badge, Button, Card, CardContent, FieldGroup, LinkButton, Radio, Select } from '@/components/ui';

export default function PublicBookingPage() {
  const t = useT();
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
    <main className="min-h-screen flex justify-center items-center p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardContent className="gap-5 p-6">
          <div>
            <LinkButton href="/" variant="link" tone="surface" size="sm" icon={<ArrowLeft className="ui-icon" aria-hidden="true" />}>
              {t('booking.backToList')}
            </LinkButton>
          </div>

          {isConfirmed ? (
            <div className="grid justify-items-center gap-4 text-center py-4">
              <Badge tone="success">
                <CheckCircle2 className="ui-icon" aria-hidden="true" />
              </Badge>
              <h3 className="ui-title">{t('booking.confirmed.title')}</h3>
              <p className="ui-text-muted">{t('booking.confirmed.summary', { type: selectedType, date: selectedDate, slot: selectedSlot })}</p>
              <p className="ui-panel ui-small p-3">{t('booking.confirmed.cancellationNote')}</p>
              <Button block onClick={() => setIsConfirmed(false)}>
                {t('booking.confirmed.newBooking')}
              </Button>
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="grid justify-items-center gap-2 text-center">
                <Badge tone="theme" className="ui-eyebrow">
                  {t('booking.badge')}
                </Badge>
                <h2 className="ui-title">{studioName}</h2>
                <p className="ui-text-muted">{t('booking.intro')}</p>
              </div>

              <form onSubmit={handleBooking} className="grid gap-4">
                <FieldGroup label={t('booking.sessionType')}>
                  <Select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                    <option value="Birebir Özel Reformer">Birebir Özel Reformer (1 Seans)</option>
                    <option value="Düet Reformer">Düet Reformer (2 Kişi)</option>
                    <option value="Cadillac Trapeze Özel">Cadillac Trapeze Özel</option>
                    <option value="Grup Reformer">Grup Reformer</option>
                  </Select>
                </FieldGroup>

                <div className="grid gap-1.5">
                  <span className="ui-caption ui-strong">{t('booking.dateSelection')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {['Bugün (18 Eylül)', 'Yarın (19 Eylül)'].map((d) => (
                      <Button
                        key={d}
                        variant={selectedDate === d ? 'soft' : 'outline'}
                        tone={selectedDate === d ? 'theme' : 'surface'}
                        size="sm"
                        aria-pressed={selectedDate === d}
                        onClick={() => setSelectedDate(d)}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>

                <fieldset className="grid gap-1.5">
                  <legend className="ui-caption ui-strong mb-1.5">{t('booking.availableSlots')}</legend>
                  {availableSlots.map((s) => (
                    <label key={s.time} className="ui-choice flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <Radio name="timeSlot" checked={selectedSlot === s.time} onChange={() => setSelectedSlot(s.time)} />
                        <span className="ui-strong">{s.time}</span>
                      </span>
                      <span className="ui-caption flex items-center gap-1">
                        <User className="ui-icon" aria-hidden="true" /> {s.trainer}
                      </span>
                    </label>
                  ))}
                </fieldset>

                <Button type="submit" block disabled={!selectedSlot}>
                  {t('booking.confirm')}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
