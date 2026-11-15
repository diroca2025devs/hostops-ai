'use client';

import { useRouter } from 'next/navigation';
import { homePathFor } from '@/lib/auth';
import { LoginScreen } from '@/screens/LoginScreen';

export default function LoginPage() {
  const router = useRouter();
  return <LoginScreen onSuccess={(session) => router.replace(homePathFor(session))} />;
}
