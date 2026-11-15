'use client';

import { useRouter } from 'next/navigation';
import { CleanerHomeScreen } from '@/screens/CleanerHomeScreen';

export default function CleanerHomePage() {
  const router = useRouter();
  return <CleanerHomeScreen onOpenTask={(id) => router.push(`/diarista/${id}`)} />;
}
