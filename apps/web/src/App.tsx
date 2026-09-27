import { FormEvent, ReactNode, SVGProps, useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, fetchQr, qrFromPayload } from './api';
import type {
  AuthStatus,
  ChatKind,
  Job,
  LogLevel,
  MessageType,
  OperationalLog,
  QrPayload,
  Rule,
  RuleAction,
  RuntimeStatus,
  Settings,
  View,
} from './types';

type IconName =
  | 'activity'
  | 'arrow'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'connection'
  | 'dashboard'
  | 'eye'
  | 'eyeOff'
  | 'info'
  | 'logout'
  | 'logs'
  | 'pause'
  | 'play'
  | 'plus'
  | 'queue'
  | 'refresh'
  | 'rules'
  | 'shield'
  | 'sparkles'
  | 'trash'
  | 'warning'
  | 'x';

function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<IconName, ReactNode> = {
    activity: <><path d="M4 12h3l2-7 4 14 2-7h5" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    connection: <><path d="M5 12a7 7 0 0 1 14 0" /><path d="M8 15a4 4 0 0 1 8 0" /><circle cx="12" cy="19" r="1" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8" /><path d="M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
    logout: <><path d="M10 5H5v14h5" /><path d="M14 8l4 4-4 4" /><path d="M8 12h10" /></>,
    logs: <><path d="M6 3h9l3 3v15H6Z" /><path d="M15 3v4h4M9 11h6M9 15h6M9 18h4" /></>,
    pause: <><path d="M9 6v12M15 6v12" /></>,
    play: <><path d="m8 5 11 7-11 7Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    queue: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3" cy="6" r=".7" fill="currentColor" /><circle cx="3" cy="12" r=".7" fill="currentColor" /><circle cx="3" cy="18" r=".7" fill="currentColor" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.3-1.7L20 12M4 12l2.6 5.7A7 7 0 0 0 17.9 16" /></>,
    rules: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" /><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7Z" /><path d="m5 14 .6 1.4L7 16l-1.4.6L5 18l-.6-1.4L3 16l1.4-.6Z" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" /></>,
    warning: <><path d="M10.4 4.2 2.7 18a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.6 4.2a1.8 1.8 0 0 0-3.2 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <div className="brand__mark" aria-hidden="true"><Icon name="clock" /><span /></div>
      {!compact && <div><strong>Whats<span>Erase</span></strong><small>controle no seu tempo</small></div>}
    </div>
  );
}

type Toast = { id: number; kind: 'success' | 'error'; text: string };

function ToastRegion({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.kind}`} key={toast.id}>
          <span className="toast__icon"><Icon name={toast.kind === 'success' ? 'check' : 'warning'} /></span>
          <p>{toast.text}</p>
          <button className="icon-button" onClick={() => dismiss(toast.id)} aria-label="Fechar aviso"><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}

function Spinner({ label = 'Carregando' }: { label?: string }) {
  return <span className="spinner" role="status"><span aria-hidden="true" /> <span className="sr-only">{label}</span></span>;
}

function InlineError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <Icon name="warning" />
      <div><strong>Não foi possível carregar</strong><p>{message}</p></div>
      {retry && <button className="button button--small button--ghost" onClick={retry}><Icon name="refresh" />Tentar novamente</button>}
    </div>
  );
}

function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name={icon} /></span>
      <h3>{title}</h3><p>{description}</p>{action}
    </div>
  );
}

const initialSettings: Settings = {
  evolutionBaseUrl: '',
  publicEvolutionUrl: '',
  instanceName: '',
  apiKeyConfigured: false,
  apiKey: '',
  webhookUrl: '',
  defaultDelaySeconds: 86400,
  dryRun: true,
  maxAttempts: 3,
};

const initialRule: Omit<Rule, 'id'> = {
  name: '', priority: 100, chatKind: 'all', chatJid: '', messageType: 'all', action: 'delete', delaySeconds: 86400,
};

function asList<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>)[key])) {
    return (value as Record<string, unknown>)[key] as T[];
  }
  return [];
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds === 0) return 'imediatamente';
  const units = [
    { value: 86400, short: 'd' },
    { value: 3600, short: 'h' },
    { value: 60, short: 'min' },
    { value: 1, short: 's' },
  ];
  let rest = Math.floor(seconds);
  const parts: string[] = [];
  for (const unit of units) {
    const amount = Math.floor(rest / unit.value);
    if (amount) {
      parts.push(`${amount}${unit.short}`);
      rest %= unit.value;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

function formatDate(date: string): string {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function formatRelative(date: string): string {
  const target = new Date(date).getTime();
  if (!Number.isFinite(target)) return 'horário desconhecido';
  const difference = target - Date.now();
  const absolute = Math.abs(difference);
  if (absolute < 60000) return difference >= 0 ? 'em menos de 1 min' : 'há menos de 1 min';
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [[86400000, 'day'], [3600000, 'hour'], [60000, 'minute']];
  const [size, unit] = steps.find(([size]) => absolute >= size) ?? steps[2];
  return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(Math.round(difference / size), unit);
}

function healthLabel(value: RuntimeStatus['evolution']): { online: boolean; label: string } {
  if (typeof value === 'boolean') return { online: value, label: value ? 'Conectado' : 'Desconectado' };
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return { online: ['connected', 'open', 'online', 'running', 'ready', 'ok', 'healthy'].includes(normalized), label: value };
  }
  if (value && typeof value === 'object') {
    const nestedConnection = value.connection && typeof value.connection === 'object' ? value.connection as Record<string, unknown> : null;
    const nestedInstance = nestedConnection?.instance && typeof nestedConnection.instance === 'object' ? nestedConnection.instance as Record<string, unknown> : null;
    const state = String(value.state ?? value.status ?? nestedInstance?.state ?? '');
    const healthyStates = ['connected', 'open', 'online', 'running', 'ready', 'ok', 'healthy'];
    const online = state
      ? healthyStates.includes(state.toLowerCase())
      : value.reachable === true || value.connected === true || value.running === true;
    const label = state || (value.reachable === true ? 'API disponível' : online ? 'Conectado' : 'Indisponível');
    return { online, label };
  }
  return { online: false, label: 'Sem informação' };
}

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [bootError, setBootError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, text }].slice(-4));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }, []);

  const loadAuth = useCallback(async () => {
    setBootError('');
    try {
      setAuth(await api<AuthStatus>('/api/auth/status'));
    } catch (error) {
      setBootError(errorMessage(error));
    }
  }, []);

  useEffect(() => { void loadAuth(); }, [loadAuth]);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  return (
    <>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      {!auth && !bootError && <BootScreen />}
      {!auth && bootError && <BootFailure error={bootError} retry={() => void loadAuth()} />}
      {auth && !auth.authenticated && (
        <AuthScreen
          setup={auth.needsSetup}
          onAuthenticated={() => setAuth({ needsSetup: false, authenticated: true })}
          notify={notify}
        />
      )}
      {auth?.authenticated && (
        <Shell
          notify={notify}
          onLoggedOut={() => setAuth({ needsSetup: false, authenticated: false })}
        />
      )}
      <ToastRegion toasts={toasts} dismiss={dismiss} />
    </>
  );
}

function BootScreen() {
  return <div className="boot-screen"><Brand /><div className="boot-loader"><span /><span /><span /></div><p>Preparando seu painel…</p></div>;
}

function BootFailure({ error, retry }: { error: string; retry: () => void }) {
  return <main className="centered-page"><Brand /><div className="boot-failure"><Icon name="warning" /><h1>Servidor indisponível</h1><p>{error}</p><button className="button button--primary" onClick={retry}><Icon name="refresh" />Tentar novamente</button></div></main>;
}

function AuthScreen({ setup, onAuthenticated, notify }: { setup: boolean; onAuthenticated: () => void; notify: (kind: Toast['kind'], text: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (setup && password.length < 10) return setError('Use pelo menos 10 caracteres.');
    if (setup && password !== confirmation) return setError('As senhas não coincidem.');
    setBusy(true);
    try {
      await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      notify('success', setup ? 'Acesso protegido. Bem-vindo ao WhatsErase.' : 'Sessão iniciada.');
      onAuthenticated();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout" id="main-content">
      <section className="auth-story">
        <div className="auth-story__inner">
          <Brand />
          <div className="auth-story__message">
            <span className="eyebrow"><Icon name="sparkles" /> automação pessoal</span>
            <h1>Mensagens no ar.<br /><em>Só pelo tempo certo.</em></h1>
            <p>Defina suas regras, acompanhe a fila e deixe a limpeza acontecer no horário — sob o seu controle.</p>
          </div>
          <div className="auth-story__timeline" aria-hidden="true">
            <div><span className="timeline-dot timeline-dot--sent"><Icon name="check" /></span><p><strong>Mensagem enviada</strong><small>agora</small></p></div>
            <i />
            <div><span className="timeline-dot"><Icon name="clock" /></span><p><strong>Exclusão agendada</strong><small>em 2 horas</small></p></div>
            <i />
            <div><span className="timeline-dot timeline-dot--muted"><Icon name="trash" /></span><p><strong>Apagar para todos</strong><small>automático</small></p></div>
          </div>
          <small className="auth-story__foot">Executado no seu servidor · Seus dados ficam com você</small>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__mobile-brand"><Brand /></div>
          <span className="auth-icon"><Icon name={setup ? 'shield' : 'clock'} /></span>
          <span className="eyebrow">{setup ? 'primeiro acesso' : 'área protegida'}</span>
          <h2>{setup ? 'Proteja seu painel' : 'Que bom ter você de volta'}</h2>
          <p>{setup ? 'Crie uma senha local para que só você possa configurar e operar o daemon.' : 'Digite sua senha para acessar o painel de controle.'}</p>
          <form onSubmit={submit} className="form-stack">
            <input className="sr-only" name="username" autoComplete="username" value="local-admin" readOnly tabIndex={-1} aria-hidden="true" />
            <label className="field">
              <span>{setup ? 'Crie uma senha' : 'Senha'}</span>
              <div className="input-with-action">
                <input autoFocus autoComplete={setup ? 'new-password' : 'current-password'} type={visible ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setup ? 'Mínimo de 10 caracteres' : 'Sua senha'} minLength={setup ? 10 : 1} required />
                <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}><Icon name={visible ? 'eyeOff' : 'eye'} /></button>
              </div>
            </label>
            {setup && <label className="field"><span>Confirme a senha</span><input autoComplete="new-password" type={visible ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>}
            {error && <div className="form-error" role="alert"><Icon name="warning" />{error}</div>}
            <button className="button button--primary button--large" disabled={busy}>{busy ? <Spinner label="Entrando" /> : <><span>{setup ? 'Criar acesso' : 'Entrar'}</span><Icon name="arrow" /></>}</button>
          </form>
          <p className="privacy-note"><Icon name="shield" />A senha é armazenada de forma protegida no seu servidor.</p>
        </div>
      </section>
    </main>
  );
}

const navigation: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'dashboard', label: 'Visão geral', icon: 'dashboard' },
  { id: 'connection', label: 'Conexão', icon: 'connection' },
  { id: 'rules', label: 'Regras', icon: 'rules' },
  { id: 'queue', label: 'Fila', icon: 'queue' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
];

const viewCopy: Record<View, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: 'painel de controle', title: 'Visão geral', description: 'Acompanhe a operação e mantenha tudo sob controle.' },
  connection: { eyebrow: 'configuração', title: 'Conexão', description: 'Conecte o WhatsApp e ajuste o comportamento do serviço.' },
  rules: { eyebrow: 'automação', title: 'Regras', description: 'Decida o que apagar, onde e depois de quanto tempo.' },
  queue: { eyebrow: 'atividade', title: 'Fila', description: 'Veja cada exclusão agendada e seu resultado.' },
  logs: { eyebrow: 'diagnóstico', title: 'Logs', description: 'Acompanhe eventos operacionais sem expor mensagens ou credenciais.' },
};

function Shell({ notify, onLoggedOut }: { notify: (kind: Toast['kind'], text: string) => void; onLoggedOut: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [statusError, setStatusError] = useState('');

  const loadStatus = useCallback(async (quiet = false) => {
    if (!quiet) setStatusError('');
    try {
      setStatus(await api<RuntimeStatus>('/api/status'));
      setStatusError('');
    } catch (error) {
      if (!quiet) setStatusError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(true), 10000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      onLoggedOut();
    } catch (error) {
      notify('error', errorMessage(error));
    }
  }

  const copy = viewCopy[view];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Navegação principal">
          <span className="sidebar__label">Seu painel</span>
          {navigation.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{view === item.id && <i />}</button>)}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar-status"><span className={`status-dot ${status?.daemonEnabled ? 'status-dot--online' : ''}`} /><p><strong>{status?.daemonEnabled ? 'Daemon ativo' : 'Daemon parado'}</strong><small>{status?.daemonEnabled ? 'Monitorando mensagens' : 'Sem monitoramento'}</small></p></div>
          <button className="logout-button" onClick={() => void logout()}><Icon name="logout" />Sair</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand"><Brand /></div>
          <div className="topbar__heading"><span className="eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
          <div className="topbar__status"><span className={`status-dot ${status?.daemonEnabled ? 'status-dot--online' : ''}`} />{status?.daemonEnabled ? 'Em operação' : 'Em espera'}</div>
        </header>
        {status?.dryRun && <div className="dry-run-banner" role="status"><span><Icon name="eye" /></span><div><strong>Modo simulação ativo</strong><p>Nenhuma mensagem será apagada. Os jobs serão processados apenas para validação.</p></div><button onClick={() => setView('connection')}>Configurar <Icon name="chevron" /></button></div>}
        <main id="main-content" className="content" tabIndex={-1}>
          {view === 'dashboard' && <Dashboard status={status} statusError={statusError} refreshStatus={loadStatus} notify={notify} goTo={setView} />}
          {view === 'connection' && <Connection notify={notify} onStatusChange={() => void loadStatus(true)} />}
          {view === 'rules' && <Rules notify={notify} />}
          {view === 'queue' && <Queue notify={notify} />}
          {view === 'logs' && <Logs />}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navegação principal">
        {navigation.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label === 'Visão geral' ? 'Início' : item.label}</span></button>)}
      </nav>
    </div>
  );
}

function Dashboard({ status, statusError, refreshStatus, notify, goTo }: { status: RuntimeStatus | null; statusError: string; refreshStatus: (quiet?: boolean) => Promise<void>; notify: (kind: Toast['kind'], text: string) => void; goTo: (view: View) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(async () => {
    setJobsError('');
    try {
      setJobs(asList<Job>(await api<unknown>('/api/jobs?limit=5'), 'jobs'));
    } catch (error) {
      setJobsError(errorMessage(error));
    }
  }, []);
  useEffect(() => { void loadJobs(); }, [loadJobs]);

  async function toggleDaemon() {
    setBusy(true);
    try {
      await api(status?.daemonEnabled ? '/api/daemon/stop' : '/api/daemon/start', { method: 'POST' });
      notify('success', status?.daemonEnabled ? 'Daemon pausado.' : 'Daemon iniciado. Novas mensagens serão monitoradas.');
      await refreshStatus();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!status && !statusError) return <PageSkeleton />;
  if (!status && statusError) return <InlineError message={statusError} retry={() => void refreshStatus()} />;
  const evolution = healthLabel(status?.evolution);
  const worker = healthLabel(status?.worker);
  const counts = status?.counts ?? {};
  const pending = (counts.pending ?? counts.queued ?? 0) + (counts.retry ?? 0) + (counts.processing ?? 0);
  const completed = counts.completed ?? ((counts.deleted ?? 0) + (counts.deleted_external ?? 0) + (counts.simulated ?? 0));
  const failed = counts.failed ?? 0;

  return (
    <div className="page-flow">
      <section className={`hero-control ${status?.daemonEnabled ? 'hero-control--running' : ''}`}>
        <div className="hero-control__copy">
          <span className="hero-control__orb"><span><Icon name={status?.daemonEnabled ? 'activity' : 'pause'} /></span></span>
          <div><span className="eyebrow">estado do serviço</span><h2>{status?.daemonEnabled ? 'Tudo em movimento' : 'Pronto quando você estiver'}</h2><p>{status?.daemonEnabled ? 'O daemon está acompanhando novas mensagens e executando suas regras.' : 'Inicie o daemon para começar a registrar e agendar mensagens enviadas.'}</p></div>
        </div>
        <button className={`button button--large ${status?.daemonEnabled ? 'button--danger-soft' : 'button--primary'}`} onClick={() => void toggleDaemon()} disabled={busy}>{busy ? <Spinner /> : <><Icon name={status?.daemonEnabled ? 'pause' : 'play'} />{status?.daemonEnabled ? 'Parar daemon' : 'Iniciar daemon'}</>}</button>
      </section>

      <section className="metric-grid" aria-label="Resumo da fila">
        <Metric label="Em aberto" value={pending} icon="clock" tone="amber" note="aguardando ou processando" />
        <Metric label="Processados" value={completed} icon="check" tone="green" note="solicitações e simulações" />
        <Metric label="Com falha" value={failed} icon="warning" tone={failed ? 'red' : 'neutral'} note={failed ? 'precisam de atenção' : 'nenhum problema'} />
      </section>

      <div className="dashboard-grid">
        <section className="card recent-card">
          <div className="card__heading"><div><span className="eyebrow">movimentações</span><h2>Atividade recente</h2></div><button className="text-button" onClick={() => goTo('queue')}>Ver toda a fila <Icon name="arrow" /></button></div>
          {jobsError && <InlineError message={jobsError} retry={() => void loadJobs()} />}
          {!jobsError && jobs.length === 0 && <EmptyState icon="queue" title="A fila está tranquila" description="As próximas mensagens monitoradas aparecerão aqui." />}
          {!jobsError && jobs.length > 0 && <div className="activity-list">{jobs.map((job) => <JobSummary key={job.id} job={job} />)}</div>}
        </section>
        <section className="card health-card">
          <div className="card__heading"><div><span className="eyebrow">infraestrutura</span><h2>Saúde do sistema</h2></div><button className="icon-button icon-button--border" onClick={() => void refreshStatus()} aria-label="Atualizar status"><Icon name="refresh" /></button></div>
          <div className="health-list">
            <HealthRow title="Evolution API" description="API e sessão do WhatsApp" health={evolution} />
            <HealthRow title="Worker" description="Processamento da fila" health={worker} />
            <HealthRow title="Proteção real" description="Modo de exclusão" health={{ online: !status?.dryRun, label: status?.dryRun ? 'Simulação' : 'Ativa' }} warning={status?.dryRun} />
          </div>
          <button className="button button--secondary button--full" onClick={() => goTo('connection')}><Icon name="connection" />Abrir configurações</button>
        </section>
      </div>
      <div className="notice"><Icon name="info" /><div><strong>Importante sobre “apagar para todos”</strong><p>A exclusão depende da janela e das regras do WhatsApp. O WhatsErase tenta dentro do prazo configurado, mas não consegue contornar limites da plataforma.</p></div></div>
    </div>
  );
}

function Metric({ label, value, icon, tone, note }: { label: string; value: number; icon: IconName; tone: string; note: string }) {
  return <article className="metric-card"><span className={`metric-card__icon metric-card__icon--${tone}`}><Icon name={icon} /></span><div><span>{label}</span><strong>{value.toLocaleString('pt-BR')}</strong><small>{note}</small></div></article>;
}

function HealthRow({ title, description, health, warning = false }: { title: string; description: string; health: { online: boolean; label: string }; warning?: boolean }) {
  return <div className="health-row"><span className={`health-row__icon ${health.online ? 'online' : warning ? 'warning' : ''}`}><Icon name={health.online ? 'check' : warning ? 'eye' : 'x'} /></span><p><strong>{title}</strong><small>{description}</small></p><span className={`health-pill ${health.online ? 'online' : warning ? 'warning' : ''}`}>{health.label}</span></div>;
}

function JobSummary({ job }: { job: Job }) {
  const meta = statusMeta(job.status);
  return <div className="activity-item"><span className={`activity-item__icon ${meta.tone}`}><Icon name={meta.icon} /></span><div className="activity-item__main"><p><strong>{displayJid(job.remoteJid)}</strong><span>· {messageTypeLabel(job.messageType)}</span></p><small>{job.simulateOnly && ['pending', 'retry'].includes(job.status) ? `Simulação protegida · execução ${formatRelative(job.deleteAt)}` : ['pending', 'retry'].includes(job.status) ? `Exclusão ${formatRelative(job.deleteAt)}` : meta.label}</small></div><span className={`status-chip status-chip--${meta.tone}`}>{meta.label}</span></div>;
}

function Connection({ notify, onStatusChange }: { notify: (kind: Toast['kind'], text: string) => void; onStatusChange: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [qr, setQr] = useState<{ image: string | null; meta: QrPayload } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await api<Settings>('/api/settings');
      setSettings({ ...initialSettings, ...response, apiKey: '' });
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (qr?.image?.startsWith('blob:')) URL.revokeObjectURL(qr.image); }, [qr]);

  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  function serializedSettings() {
    if (!settings) return {};
    const payload: Record<string, unknown> = {
      evolutionBaseUrl: settings.evolutionBaseUrl,
      publicEvolutionUrl: settings.publicEvolutionUrl,
      instanceName: settings.instanceName,
      webhookUrl: settings.webhookUrl,
      defaultDelaySeconds: settings.defaultDelaySeconds,
      dryRun: settings.dryRun,
      maxAttempts: settings.maxAttempts,
    };
    if (settings.apiKey) payload.apiKey = settings.apiKey;
    return payload;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    const payload = serializedSettings();
    try {
      const response = await api<Settings | null>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSettings({
        ...settings,
        ...(response ?? {}),
        apiKey: '',
        apiKeyConfigured: response?.apiKeyConfigured ?? (settings.apiKeyConfigured || Boolean(settings.apiKey)),
      });
      notify('success', 'Configurações salvas.');
      onStatusChange();
    } catch (saveError) {
      notify('error', errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runOperation(name: 'test' | 'instance' | 'qr') {
    if (!settings) return;
    setOperation(name);
    try {
      const saved = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(serializedSettings()) });
      setSettings((current) => current ? { ...current, ...saved, apiKey: '' } : current);
      if (name === 'test') {
        await api('/api/evolution/test', { method: 'POST' });
        notify('success', 'Conexão com a Evolution API confirmada.');
      } else if (name === 'instance') {
        const instanceResponse = await api<QrPayload>('/api/evolution/instance', { method: 'POST', body: JSON.stringify({ instanceName: settings.instanceName }) });
        const qrResponse = qrFromPayload(instanceResponse);
        setQr(qrResponse);
        notify('success', qrResponse.meta.connected ? 'WhatsApp já está conectado.' : 'Instância preparada. Agora leia o QR Code.');
      } else {
        const qrResponse = await fetchQr();
        setQr(qrResponse);
        if (qrResponse.meta.connected) notify('success', 'WhatsApp já está conectado.');
        else if (!qrResponse.image) notify('error', 'A API não retornou uma imagem de QR Code.');
      }
      onStatusChange();
    } catch (operationError) {
      notify('error', errorMessage(operationError));
    } finally {
      setOperation(null);
    }
  }

  if (!settings && !error) return <PageSkeleton />;
  if (!settings && error) return <InlineError message={error} retry={() => void load()} />;
  if (!settings) return null;

  return (
    <form className="page-flow" onSubmit={save}>
      <section className="card settings-section">
        <div className="section-heading"><span className="section-heading__icon"><Icon name="connection" /></span><div><span className="eyebrow">passo 1</span><h2>Evolution API</h2><p>Informe onde sua instância está rodando e a chave de acesso.</p></div><span className={`config-badge ${settings.apiKeyConfigured ? 'complete' : ''}`}><Icon name={settings.apiKeyConfigured ? 'check' : 'clock'} />{settings.apiKeyConfigured ? 'Configurada' : 'Pendente'}</span></div>
        <div className="form-grid">
          <label className="field field--wide"><span>URL interna da Evolution API</span><input type="url" value={settings.evolutionBaseUrl} onChange={(event) => change('evolutionBaseUrl', event.target.value)} placeholder="http://evolution:8080" required /><small>Endereço de rede usado pelo backend — em Docker, normalmente o nome do serviço.</small></label>
          <label className="field field--wide"><span>URL pública da Evolution API <em className="optional-label">opcional</em></span><input type="url" value={settings.publicEvolutionUrl} onChange={(event) => change('publicEvolutionUrl', event.target.value)} placeholder="https://evolution.seudominio.com" /><small>Endereço externo usado apenas para referência e diagnóstico.</small></label>
          <label className="field"><span>Nome da instância</span><input value={settings.instanceName} onChange={(event) => change('instanceName', event.target.value)} placeholder="meu-whatsapp" required /></label>
          <label className="field"><span>Chave da API</span><div className="input-with-action"><input type={showApiKey ? 'text' : 'password'} value={settings.apiKey ?? ''} onChange={(event) => change('apiKey', event.target.value)} placeholder={settings.apiKeyConfigured ? '••••••••  (mantida se vazio)' : 'Cole sua chave aqui'} /><button type="button" onClick={() => setShowApiKey((value) => !value)} aria-label={showApiKey ? 'Ocultar chave' : 'Mostrar chave'}><Icon name={showApiKey ? 'eyeOff' : 'eye'} /></button></div></label>
        </div>
        <div className="section-actions"><button type="button" className="button button--secondary" onClick={() => void runOperation('test')} disabled={Boolean(operation)}>{operation === 'test' ? <Spinner /> : <Icon name="activity" />}Testar conexão</button><button type="button" className="button button--ghost" onClick={() => void runOperation('instance')} disabled={Boolean(operation) || !settings.instanceName}>{operation === 'instance' ? <Spinner /> : <Icon name="plus" />}Criar/preparar instância</button></div>
      </section>

      <section className="card settings-section">
        <div className="section-heading"><span className="section-heading__icon section-heading__icon--amber"><Icon name="connection" /></span><div><span className="eyebrow">passo 2</span><h2>Vincular WhatsApp</h2><p>Use o celular principal para ler o código da instância.</p></div></div>
        <div className="qr-layout">
          <div className={`qr-frame ${qr?.meta.connected ? 'qr-frame--connected' : ''}`}>
            {qr?.meta.connected ? <div className="qr-placeholder qr-placeholder--success"><span><Icon name="check" /></span><strong>WhatsApp conectado</strong><small>A sessão está pronta para uso.</small></div> : qr?.image ? <img src={qr.image} alt="QR Code para conectar o WhatsApp" /> : <div className="qr-placeholder"><Icon name="connection" /><strong>QR Code ainda não carregado</strong><small>Clique ao lado; a instância será preparada automaticamente.</small></div>}
          </div>
          <div className="qr-instructions"><ol><li><span>1</span><p>Abra o <strong>WhatsApp</strong> no celular</p></li><li><span>2</span><p>Vá em <strong>Aparelhos conectados</strong></p></li><li><span>3</span><p>Toque em <strong>Conectar um aparelho</strong></p></li></ol><button type="button" className="button button--secondary" onClick={() => void runOperation('qr')} disabled={Boolean(operation)}>{operation === 'qr' ? <Spinner /> : <Icon name="refresh" />}{qr?.image ? 'Atualizar QR Code' : 'Preparar e carregar QR Code'}</button></div>
        </div>
      </section>

      <section className="card settings-section">
        <div className="section-heading"><span className="section-heading__icon section-heading__icon--violet"><Icon name="rules" /></span><div><span className="eyebrow">comportamento</span><h2>Preferências do daemon</h2><p>Valores padrão usados quando nenhuma regra mais específica combinar.</p></div></div>
        <div className="form-grid form-grid--three">
          <label className="field"><span>Atraso padrão (segundos)</span><input type="number" min="10" max="169200" step="1" value={settings.defaultDelaySeconds} onChange={(event) => change('defaultDelaySeconds', Number(event.target.value))} required /><small>{formatDuration(settings.defaultDelaySeconds)} · máximo 47h</small></label>
          <label className="field"><span>Máximo de tentativas</span><input type="number" min="1" max="10" step="1" value={settings.maxAttempts} onChange={(event) => change('maxAttempts', Number(event.target.value))} required /><small>Em caso de falha temporária.</small></label>
          <div className="field"><span>Modo de execução</span><label className={`toggle-card ${settings.dryRun ? 'active' : ''}`}><input type="checkbox" checked={settings.dryRun} onChange={(event) => change('dryRun', event.target.checked)} /><span className="switch" aria-hidden="true"><i /></span><span><strong>Modo simulação</strong><small>{settings.dryRun ? 'Não apaga mensagens' : 'Exclusões reais ativas'}</small></span></label></div>
          <label className="field field--wide"><span>URL do webhook</span><div className="input-with-copy"><input value={settings.webhookUrl} readOnly placeholder="Gerada pelo servidor" /><button type="button" className="button button--ghost button--small" onClick={() => { void navigator.clipboard?.writeText(settings.webhookUrl); notify('success', 'URL copiada.'); }} disabled={!settings.webhookUrl}>Copiar</button></div><small>Configure esta URL nos eventos de mensagens da sua instância.</small></label>
        </div>
      </section>
      <div className="sticky-save"><div><Icon name="shield" /><p><strong>Configuração local e protegida</strong><small>A chave nunca é exibida novamente depois de salva.</small></p></div><button className="button button--primary button--large" disabled={saving}>{saving ? <Spinner label="Salvando" /> : <><Icon name="check" />Salvar configurações</>}</button></div>
    </form>
  );
}

function Rules({ notify }: { notify: (kind: Toast['kind'], text: string) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Rule | Omit<Rule, 'id'> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = asList<Rule>(await api<unknown>('/api/rules'), 'rules');
      setRules(response.sort((a, b) => b.priority - a.priority));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveRule(rule: Rule | Omit<Rule, 'id'>) {
    setSaving(true);
    try {
      const hasId = 'id' in rule;
      const payload = {
        name: rule.name,
        priority: rule.priority,
        chatKind: rule.chatKind,
        chatJid: rule.chatKind === 'exact' ? rule.chatJid : null,
        messageType: rule.messageType,
        action: rule.action,
        delaySeconds: rule.action === 'delete' ? rule.delaySeconds : null,
        enabled: rule.enabled ?? true,
      };
      await api(hasId ? `/api/rules/${encodeURIComponent(rule.id)}` : '/api/rules', { method: hasId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      notify('success', hasId ? 'Regra atualizada.' : 'Regra criada.');
      setEditing(null);
      await load();
    } catch (saveError) {
      notify('error', errorMessage(saveError));
    } finally { setSaving(false); }
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`Excluir a regra “${rule.name}”?`)) return;
    try {
      await api(`/api/rules/${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
      notify('success', 'Regra excluída.');
      setRules((current) => current.filter((item) => item.id !== rule.id));
    } catch (removeError) { notify('error', errorMessage(removeError)); }
  }

  return (
    <div className="page-flow">
      <section className="rules-intro">
        <div><span className="eyebrow">proteções sempre vencem</span><h2>Seu manual de limpeza</h2><p>Regras “manter” protegem a mensagem. Entre regras de exclusão, o maior número tem prioridade.</p></div>
        <button className="button button--primary" onClick={() => setEditing({ ...initialRule })}><Icon name="plus" />Nova regra</button>
      </section>
      {loading && <RulesSkeleton />}
      {!loading && error && <InlineError message={error} retry={() => void load()} />}
      {!loading && !error && rules.length === 0 && <div className="card"><EmptyState icon="rules" title="Nenhuma regra ainda" description="Crie sua primeira regra para decidir quando mensagens devem sair do ar." action={<button className="button button--primary" onClick={() => setEditing({ ...initialRule })}><Icon name="plus" />Criar primeira regra</button>} /></div>}
      {!loading && !error && rules.length > 0 && <div className="rule-list">{rules.map((rule, index) => <RuleCard key={rule.id} rule={rule} position={index + 1} edit={() => setEditing(rule)} remove={() => void remove(rule)} />)}</div>}
      {editing && <RuleEditor value={editing} saving={saving} onClose={() => setEditing(null)} onSave={(rule) => void saveRule(rule)} />}
    </div>
  );
}

function RuleCard({ rule, position, edit, remove }: { rule: Rule; position: number; edit: () => void; remove: () => void }) {
  return (
    <article className={`rule-card ${rule.action === 'keep' ? 'rule-card--keep' : ''}`}>
      <div className="rule-card__order"><span>{position.toString().padStart(2, '0')}</span><small>prior. {rule.priority}</small></div>
      <div className="rule-card__body"><div className="rule-card__title"><span className={`rule-action rule-action--${rule.action}`}><Icon name={rule.action === 'delete' ? 'trash' : 'shield'} />{rule.action === 'delete' ? 'apagar' : 'manter'}</span><h3>{rule.name}</h3></div><div className="rule-sentence">Para <strong>{chatKindLabel(rule.chatKind, rule.chatJid)}</strong>, em mensagens de <strong>{messageTypeLabel(rule.messageType)}</strong>, <strong>{rule.action === 'keep' ? 'nunca apagar' : `apagar após ${formatDuration(rule.delaySeconds ?? 0)}`}</strong>.</div></div>
      <div className="rule-card__actions"><button className="button button--small button--ghost" onClick={edit}>Editar</button><button className="icon-button icon-button--danger" onClick={remove} aria-label={`Excluir regra ${rule.name}`}><Icon name="trash" /></button></div>
    </article>
  );
}

function RuleEditor({ value, saving, onClose, onSave }: { value: Rule | Omit<Rule, 'id'>; saving: boolean; onClose: () => void; onSave: (value: Rule | Omit<Rule, 'id'>) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const isEditing = 'id' in value;
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  function change<K extends keyof Omit<Rule, 'id'>>(key: K, changed: Omit<Rule, 'id'>[K]) {
    setDraft((current) => ({ ...current, [key]: changed }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setError('Dê um nome para a regra.');
    if (draft.chatKind === 'exact' && !draft.chatJid?.trim()) return setError('Informe o JID da conversa específica.');
    onSave({ ...draft, chatJid: draft.chatKind === 'exact' ? draft.chatJid?.trim() : null });
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="rule-title">
        <header><div><span className="eyebrow">{isEditing ? 'editar automação' : 'nova automação'}</span><h2 id="rule-title">{isEditing ? 'Ajustar regra' : 'Criar uma regra'}</h2></div><button className="icon-button icon-button--border" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button></header>
        <form onSubmit={submit}>
          <div className="modal__body form-stack">
            <label className="field"><span>Nome da regra</span><input autoFocus value={draft.name} onChange={(event) => change('name', event.target.value)} placeholder="Ex.: Grupos somem em 2 horas" required /></label>
            <div className="form-grid">
              <label className="field"><span>Prioridade</span><input type="number" min="-10000" max="10000" step="1" value={draft.priority} onChange={(event) => change('priority', Number(event.target.value))} required /><small>Maior número tem precedência.</small></label>
              <label className="field"><span>Ação</span><select value={draft.action} onChange={(event) => { const action = event.target.value as RuleAction; setDraft((current) => ({ ...current, action, delaySeconds: action === 'delete' ? current.delaySeconds ?? 86400 : null })); }}><option value="delete">Apagar para todos</option><option value="keep">Manter mensagem</option></select></label>
              <label className="field"><span>Tipo de conversa</span><select value={draft.chatKind} onChange={(event) => change('chatKind', event.target.value as ChatKind)}><option value="all">Todas as conversas</option><option value="direct">Conversas individuais</option><option value="group">Grupos</option><option value="exact">Conversa específica</option></select></label>
              <label className="field"><span>Tipo de mensagem</span><select value={draft.messageType} onChange={(event) => change('messageType', event.target.value as MessageType)}><option value="all">Qualquer tipo</option><option value="text">Texto</option><option value="image">Imagem</option><option value="video">Vídeo</option><option value="audio">Áudio</option><option value="document">Documento</option><option value="sticker">Figurinha</option><option value="other">Outro</option></select></label>
            </div>
            {draft.chatKind === 'exact' && <label className="field"><span>JID da conversa</span><input value={draft.chatJid ?? ''} onChange={(event) => change('chatJid', event.target.value)} placeholder="5511999999999@s.whatsapp.net" required /><small>Use o identificador completo recebido pela Evolution API.</small></label>}
            {draft.action === 'delete' && <label className="field"><span>Apagar depois de (segundos)</span><input type="number" min="10" max="169200" step="1" value={draft.delaySeconds ?? 86400} onChange={(event) => change('delaySeconds', Number(event.target.value))} required /><small>Resultado: {formatDuration(draft.delaySeconds ?? 0)} · máximo 47h</small></label>}
            <div className={`rule-preview rule-preview--${draft.action}`}><Icon name={draft.action === 'delete' ? 'clock' : 'shield'} /><p><span>Esta regra vai</span><strong>{draft.action === 'delete' ? `agendar a exclusão após ${formatDuration(draft.delaySeconds ?? 0)}` : 'impedir a exclusão das mensagens correspondentes'}</strong></p></div>
            {error && <div className="form-error" role="alert"><Icon name="warning" />{error}</div>}
          </div>
          <footer><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary" disabled={saving}>{saving ? <Spinner /> : <><Icon name="check" />{isEditing ? 'Salvar alterações' : 'Criar regra'}</>}</button></footer>
        </form>
      </section>
    </div>
  );
}

const jobFilters = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Aguardando' },
  { value: 'retry', label: 'Nova tentativa' },
  { value: 'processing', label: 'Processando' },
  { value: 'deleted', label: 'Solicitações' },
  { value: 'simulated', label: 'Simulados' },
  { value: 'failed', label: 'Falhas' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: 'deleted_external', label: 'Apagados fora' },
];

function Queue({ notify }: { notify: (kind: Toast['kind'], text: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (filter) query.set('status', filter);
      setJobs(asList<Job>(await api<unknown>(`/api/jobs?${query}`), 'jobs'));
    } catch (loadError) { setError(errorMessage(loadError)); }
    finally { if (!quiet) setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 10000); return () => window.clearInterval(timer); }, [load]);

  async function jobAction(job: Job, action: 'retry' | 'cancel') {
    setActionId(job.id);
    try {
      await api(`/api/jobs/${encodeURIComponent(job.id)}/${action}`, { method: 'POST' });
      notify('success', action === 'retry' ? 'Job reenviado para a fila.' : 'Job cancelado.');
      await load(true);
    } catch (actionError) { notify('error', errorMessage(actionError)); }
    finally { setActionId(''); }
  }

  async function createTest() {
    setCreating(true);
    try {
      await api('/api/jobs/test', { method: 'POST' });
      notify('success', 'Job simulado criado.');
      await load(true);
    } catch (createError) { notify('error', errorMessage(createError)); }
    finally { setCreating(false); }
  }

  const counts = useMemo(() => jobs.reduce<Record<string, number>>((result, job) => ({ ...result, [job.status]: (result[job.status] ?? 0) + 1 }), {}), [jobs]);
  return (
    <div className="page-flow">
      <section className="queue-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filtrar jobs por status">{jobFilters.map((item) => <button key={item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.label}{item.value && counts[item.value] !== undefined && <span>{counts[item.value]}</span>}</button>)}</div>
        <div className="queue-toolbar__actions"><button className="button button--ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" />Atualizar</button><button className="button button--secondary" onClick={() => void createTest()} disabled={creating}>{creating ? <Spinner /> : <Icon name="sparkles" />}Criar job de teste</button></div>
      </section>
      {loading && <QueueSkeleton />}
      {!loading && error && <InlineError message={error} retry={() => void load()} />}
      {!loading && !error && jobs.length === 0 && <div className="card"><EmptyState icon="queue" title={filter ? 'Nada neste filtro' : 'Nenhum job na fila'} description={filter ? 'Tente outro status ou atualize daqui a pouco.' : 'Crie um job simulado para validar o fluxo sem precisar enviar uma mensagem.'} action={!filter && <button className="button button--secondary" onClick={() => void createTest()}><Icon name="sparkles" />Criar job de teste</button>} /></div>}
      {!loading && !error && jobs.length > 0 && <section className="jobs-card"><div className="jobs-table-wrap"><table className="jobs-table"><thead><tr><th>Destino / mensagem</th><th>Envio</th><th>Exclusão</th><th>Tentativas</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{jobs.map((job) => <JobRow key={job.id} job={job} busy={actionId === job.id} action={(action) => void jobAction(job, action)} />)}</tbody></table></div></section>}
      <div className="queue-legend"><Icon name="refresh" /><p>A fila é atualizada automaticamente a cada 10 segundos. Horários exibidos no fuso do seu navegador.</p></div>
      <div className="queue-legend"><Icon name="info" /><p><strong>Solicitação enviada</strong> significa que a Evolution aceitou o HTTP; não é confirmação de remoção em todos os aparelhos.</p></div>
    </div>
  );
}

function JobRow({ job, busy, action }: { job: Job; busy: boolean; action: (action: 'retry' | 'cancel') => void }) {
  const meta = statusMeta(job.status);
  return <tr><td data-label="Destino"><div className="job-destination"><span>{messageTypeGlyph(job.messageType)}</span><p><strong>{displayJid(job.remoteJid)}</strong><small>{messageTypeLabel(job.messageType)} · #{job.id.slice(0, 8)}{job.simulateOnly ? ' · simulação protegida' : ''}</small>{job.lastError && <details><summary>Ver erro</summary><p>{job.lastError}</p></details>}</p></div></td><td data-label="Envio"><time dateTime={job.sentAt}>{formatDate(job.sentAt)}</time></td><td data-label="Exclusão"><time dateTime={job.deleteAt}>{formatDate(job.deleteAt)}</time><small className="table-relative">{['pending', 'retry'].includes(job.status) && formatRelative(job.deleteAt)}</small></td><td data-label="Tentativas"><span className="attempt-count">{job.attemptCount}</span></td><td data-label="Status"><span className={`status-chip status-chip--${meta.tone}`}><i />{meta.label}</span></td><td className="job-actions"><div>{['failed', 'cancelled'].includes(job.status) && <button className="icon-button icon-button--border" onClick={() => action('retry')} disabled={busy} aria-label={`Tentar job ${job.id} novamente`}>{busy ? <Spinner /> : <Icon name="refresh" />}</button>}{['pending', 'retry'].includes(job.status) && <button className="icon-button icon-button--danger" onClick={() => action('cancel')} disabled={busy} aria-label={`Cancelar job ${job.id}`}>{busy ? <Spinner /> : <Icon name="x" />}</button>}</div></td></tr>;
}

const logFilters: Array<{ value: '' | LogLevel; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'info', label: 'Informações' },
  { value: 'warn', label: 'Alertas' },
  { value: 'error', label: 'Erros' },
];

const sensitiveLogKey = /password|passwd|secret|token|api[-_]?key|authorization|cookie|session|credential|qrcode|qr_code|base64|content|body|payload|text|headers?|^(?:message|raw|data)$/i;

function redactLogString(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[credencial oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[token oculto]')
    .replace(/([?&](?:token|api[-_]?key|secret|password)=)[^&\s]+/gi, '$1[oculto]')
    .slice(0, 500);
}

function safeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactLogString(value);
  if (depth >= 3) return '[resumido]';
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => safeLogValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, item]) => [key, sensitiveLogKey.test(key) ? '[oculto]' : safeLogValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function safeLogDetails(details: OperationalLog['details']): string | null {
  if (!details || Object.keys(details).length === 0) return null;
  return JSON.stringify(safeLogValue(details), null, 2);
}

function formatLogDate(date: string): string {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return 'Horário desconhecido';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(value);
}

function Logs() {
  const [logs, setLogs] = useState<OperationalLog[]>([]);
  const [filter, setFilter] = useState<'' | LogLevel>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '200' });
      if (filter) query.set('level', filter);
      const response = await api<unknown>(`/api/logs?${query}`);
      setLogs(asList<OperationalLog>(response, 'logs'));
      setLastUpdatedAt(new Date());
      setError('');
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="page-flow">
      <section className="queue-toolbar logs-toolbar">
        <div className="filter-tabs" role="group" aria-label="Filtrar logs por nível">
          {logFilters.map((item) => (
            <button key={item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)} aria-pressed={filter === item.value}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="queue-toolbar__actions">
          <button className="button button--ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner label="Atualizando logs" /> : <Icon name="refresh" />}Atualizar
          </button>
        </div>
      </section>

      {loading && <LogsSkeleton />}
      {!loading && error && <InlineError message={error} retry={() => void load()} />}
      {!loading && logs.length === 0 && !error && (
        <div className="card"><EmptyState icon="logs" title={filter ? 'Nenhum evento neste nível' : 'Nenhum log registrado'} description={filter ? 'Escolha outro nível ou aguarde a próxima atualização.' : 'Os eventos do daemon, webhook e worker aparecerão aqui.'} /></div>
      )}
      {!loading && logs.length > 0 && (
        <section className="logs-card" aria-label="Eventos operacionais">
          <ol className="logs-list">
            {logs.map((log) => <LogEntry key={String(log.id)} log={log} />)}
          </ol>
        </section>
      )}
      <div className="queue-legend logs-legend">
        <Icon name="refresh" />
        <p>Atualização automática a cada 5 segundos{lastUpdatedAt ? ` · última às ${lastUpdatedAt.toLocaleTimeString('pt-BR')}` : ''}. Conteúdos e campos sensíveis permanecem ocultos.</p>
      </div>
    </div>
  );
}

function LogEntry({ log }: { log: OperationalLog }) {
  const level = ['info', 'warn', 'error'].includes(log.level) ? log.level : 'info';
  const details = safeLogDetails(log.details);
  const label = level === 'error' ? 'Erro' : level === 'warn' ? 'Alerta' : 'Info';
  return (
    <li className={`log-entry log-entry--${level}`}>
      <div className="log-entry__marker" aria-hidden="true"><Icon name={level === 'error' ? 'x' : level === 'warn' ? 'warning' : 'info'} /></div>
      <div className="log-entry__body">
        <div className="log-entry__meta">
          <span className={`log-level log-level--${level}`}>{label}</span>
          <strong>{redactLogString(log.event || 'evento')}</strong>
          <time dateTime={log.createdAt}>{formatLogDate(log.createdAt)}</time>
        </div>
        <p>{redactLogString(log.message || 'Evento sem descrição.')}</p>
        {details && <details className="log-details"><summary>Detalhes técnicos</summary><pre>{details}</pre></details>}
      </div>
    </li>
  );
}

function statusMeta(status: string): { label: string; tone: string; icon: IconName } {
  const normalized = status.toLowerCase();
  if (normalized === 'pending') return { label: 'Aguardando', tone: 'amber', icon: 'clock' };
  if (normalized === 'processing') return { label: 'Processando', tone: 'blue', icon: 'refresh' };
  if (normalized === 'retry') return { label: 'Nova tentativa', tone: 'amber', icon: 'refresh' };
  if (normalized === 'completed' || normalized === 'done') return { label: 'Concluído', tone: 'green', icon: 'check' };
  if (normalized === 'deleted') return { label: 'Solicitação enviada', tone: 'green', icon: 'check' };
  if (normalized === 'simulated') return { label: 'Simulado', tone: 'violet', icon: 'eye' };
  if (normalized === 'deleted_external') return { label: 'Apagado externamente', tone: 'violet', icon: 'shield' };
  if (normalized === 'failed') return { label: 'Falhou', tone: 'red', icon: 'warning' };
  if (normalized === 'cancelled' || normalized === 'canceled') return { label: 'Cancelado', tone: 'neutral', icon: 'x' };
  if (normalized === 'skipped') return { label: 'Ignorado', tone: 'violet', icon: 'shield' };
  return { label: status || 'Desconhecido', tone: 'neutral', icon: 'info' };
}

function displayJid(jid: string): string {
  if (!jid) return 'Destino desconhecido';
  const raw = jid.split('@')[0];
  if (jid.includes('@g.us')) return `Grupo ${raw.slice(-8)}`;
  if (/^\d{12,13}$/.test(raw)) return `+${raw.slice(0, 2)} ${raw.slice(2, 4)} ${raw.slice(4, 9)}-${raw.slice(9)}`;
  return raw;
}

function chatKindLabel(kind: ChatKind, jid?: string | null): string {
  return ({ all: 'todas as conversas', direct: 'conversas individuais', group: 'grupos', exact: jid ? displayJid(jid) : 'uma conversa específica' })[kind];
}

function messageTypeLabel(type: string): string {
  return ({ all: 'qualquer tipo', text: 'texto', image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento', sticker: 'figurinha', other: 'outro tipo' } as Record<string, string>)[type] ?? type;
}

function messageTypeGlyph(type: string): string {
  return ({ text: 'Aa', image: '◫', video: '▶', audio: '♪', document: '⌑', sticker: '✦' } as Record<string, string>)[type] ?? '•';
}

function PageSkeleton() { return <div className="page-flow" aria-label="Carregando"><div className="skeleton skeleton--hero" /><div className="metric-grid"><div className="skeleton skeleton--metric" /><div className="skeleton skeleton--metric" /><div className="skeleton skeleton--metric" /></div><div className="skeleton skeleton--card" /></div>; }
function RulesSkeleton() { return <div className="rule-list" aria-label="Carregando regras">{[1, 2, 3].map((item) => <div className="skeleton skeleton--rule" key={item} />)}</div>; }
function QueueSkeleton() { return <div className="skeleton skeleton--table" aria-label="Carregando fila" />; }
function LogsSkeleton() { return <div className="logs-skeleton" aria-label="Carregando logs">{[1, 2, 3, 4].map((item) => <div className="skeleton skeleton--log" key={item} />)}</div>; }

export default App;
