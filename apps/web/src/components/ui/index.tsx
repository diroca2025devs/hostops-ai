'use client';

import '@/lib/fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCircleExclamation, faCircleInfo, faInbox, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { initials } from '@/lib/format';
import styles from './ui.module.css';

/** Primitivos de interface reutilizáveis. Não conhecem regras de negócio nem rotas. */
export type Tone = 'neutral' | 'brand' | 'green' | 'amber' | 'rose' | 'teal';
const toneClass: Record<Tone, string> = {
  neutral: '',
  brand: styles.toneBrand!,
  green: styles.toneGreen!,
  amber: styles.toneAmber!,
  rose: styles.toneRose!,
  teal: styles.toneTeal!,
};
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export { FontAwesomeIcon as Icon };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
  size?: 'small' | 'default' | 'block';
  icon?: IconDefinition;
}
export function Button({ variant = 'primary', size = 'default', icon, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(styles.button, styles[variant], size !== 'default' && styles[size], className)} {...rest}>
      {icon && <FontAwesomeIcon icon={icon} />}
      {children}
    </button>
  );
}

export function Card({ children, title, action, pad = true, className }: { children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={cx(styles.card, pad && styles.cardPad, className)}>
      {(title || action) && (
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx(styles.badge, toneClass[tone])}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function StatCard({ icon, label, value, tone = 'brand' }: { icon: IconDefinition; label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className={cx(styles.card, styles.stat)}>
      <span className={cx(styles.statIcon, toneClass[tone] || styles.toneBrand)}>
        <FontAwesomeIcon icon={icon} />
      </span>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Field({ label, hint, children, span2 }: { label: string; hint?: string; children: ReactNode; span2?: boolean }) {
  return (
    <label className={cx(styles.field, span2 && styles.span2)}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  );
}
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(styles.input, props.className)} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(styles.input, props.className)} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cx(styles.input, props.className)} />;
export const FormGrid = ({ children }: { children: ReactNode }) => <div className={styles.formGrid}>{children}</div>;

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.cardTitle}>{title}</h2>
          <button className={styles.iconButton} onClick={onClose} aria-label="Fechar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'rose', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={cx(styles.alert, toneClass[tone])} role={tone === 'rose' ? 'alert' : 'status'}>
      <FontAwesomeIcon icon={tone === 'rose' || tone === 'amber' ? faCircleExclamation : faCircleInfo} style={{ marginTop: 3 }} />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ children, icon = faInbox }: { children: ReactNode; icon?: IconDefinition }) {
  return (
    <div className={styles.empty}>
      <FontAwesomeIcon icon={icon} className={styles.emptyIcon} />
      <div>{children}</div>
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** Estados padrão de carregamento/erro/vazio para blocos alimentados pela API. */
export function DataState({ loading, error, empty, emptyText, children }: { loading: boolean; error: string | null; empty?: boolean; emptyText?: string; children: ReactNode }) {
  if (error) return <Alert>{error}</Alert>;
  if (loading && empty !== false) return <p className={styles.muted}>Carregando…</p>;
  if (empty) return <EmptyState>{emptyText ?? 'Nada por aqui ainda.'}</EmptyState>;
  return <>{children}</>;
}

export const Muted = ({ children }: { children: ReactNode }) => <span className={styles.muted}>{children}</span>;
export const Mono = ({ children }: { children: ReactNode }) => <span className={styles.mono}>{children}</span>;
