'use client';

import { Table, Thead, Tbody, Tr, Th } from '@/components/ui';

/** Plain table used by the integrations hub sections: flat, hairline rows, no card inside a card. */
export function HubTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            {head.map((h, index) => (
              <Th key={`${h}-${index}`} className="ui-small">
                {h}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>{children}</Tbody>
      </Table>
    </div>
  );
}
