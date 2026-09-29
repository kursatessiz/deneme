'use client';

/** Plain table used by the integrations hub sections: flat, hairline rows, no card inside a card. */
export function HubTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--color-text-muted)' }}>
            {head.map((h, index) => (
              <th key={`${h}-${index}`} className="text-left font-medium text-xs py-1.5 pr-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
