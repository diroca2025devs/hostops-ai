'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SettingsScreen } from '@/screens/SettingsScreen';

function Settings() {
  // ?google=conectado|negado|erro é definido pelo retorno do OAuth do Google.
  const google = useSearchParams().get('google');
  return <SettingsScreen googleResult={google} />;
}

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
