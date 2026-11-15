'use client';

import { useParams, useRouter } from 'next/navigation';
import { CleanerTaskScreen } from '@/screens/CleanerTaskScreen';

export default function CleanerTaskPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  return <CleanerTaskScreen taskId={params.id} onBack={() => router.push('/diarista')} />;
}
