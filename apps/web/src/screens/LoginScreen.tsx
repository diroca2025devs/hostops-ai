'use client';

import { faLayerGroup, faRightToBracket } from '@fortawesome/free-solid-svg-icons';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Icon, Input } from '@/components/ui';
import { useAuth, type Session } from '@/lib/auth';
import { useSubmit } from '@/lib/useSubmit';
import styles from './screens.module.css';

export function LoginScreen({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const session = await run(() => login(email, password));
    if (session) onSuccess(session);
  };

  return (
    <div className={styles.loginPage}>
      <Card className={styles.loginCard}>
        <div className={styles.loginBrand}>
          <span className={styles.loginMark}>
            <Icon icon={faLayerGroup} />
          </span>
          HostOps AI
        </div>
        <p className={styles.sub} style={{ marginBottom: 20 }}>
          Reservas, limpeza e atendimento dos seus imóveis em um só lugar.
        </p>
        <form onSubmit={submit} className={styles.stack} style={{ gap: 14 }}>
          <Field label="E-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" size="block" icon={faRightToBracket} disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
