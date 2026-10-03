import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CheckmarkCircle01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/shared/lib/platform";
import {
  ApiError,
  api,
  clearAccessToken,
  clearSessionHint,
  completeTwoFactor,
  hasSessionHint,
  login,
  messageForError,
  register,
} from "@/shared/api";
import { useIsomorphicLayoutEffect } from "@/shared/hooks";
import { useT } from "@/shared/i18n";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

function AuthIcon({
  icon,
  size = 20,
  className,
}: {
  icon: IconData;
  size?: number;
  className?: string;
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={className} />;
}

/**
 * Sends an already-signed-in visitor straight to the dashboard: the session lives in an httpOnly
 * refresh cookie, so a returning visitor would otherwise see the sign-in form before the API
 * answers.
 *
 * An absent local-storage hint is not conclusive: a visitor whose session predates the hint holds
 * a valid refresh cookie but no hint, and skipping the probe would strand them on the sign-in
 * form. The probe therefore always runs; a failed probe is still caught and ignored, and only an
 * authoritative 401 clears the session — a transport or server fault keeps the hint so the next
 * visit probes again.
 *
 * Returns whether the form should be held back. The server render has no session to read, so the
 * first client render is the server's (the form) and the layout effect decides before the browser
 * paints: a browser that has held a session shows `AuthSessionCheck` while the probe runs instead
 * of the form that is about to be navigated away from, while a first-time visitor gets the form at
 * once — no session can exist for them, so there is nothing to wait for.
 */
function useRedirectWhenAuthed(): boolean {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  useIsomorphicLayoutEffect(() => {
    if (hasSessionHint()) setChecking(true);
  }, []);
  useEffect(() => {
    let active = true;
    void api
      .get("/api/v1/me")
      .then(() => {
        if (active) void navigate({ to: "/" });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          clearAccessToken();
          clearSessionHint();
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);
  return checking;
}

/**
 * What a returning visitor sees while the probe confirms their session: the brand, and a status the
 * screen reader reads, so the redirect that follows is not preceded by a form that asks them to
 * sign in again.
 */
function AuthSessionCheck() {
  const t = useT("auth");
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div role="status" className="flex flex-col items-center gap-4">
        <img
          src="/Louma_Brand_logos/png/louma-logo-256x256.png"
          alt={t("logoAlt")}
          width={64}
          height={64}
          draggable={false}
          className="size-16 shrink-0 border-0 bg-transparent object-contain shadow-none"
        />
        <span
          aria-hidden
          className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground"
        />
        <p className="text-sm text-muted-foreground">{t("session.checking")}</p>
      </div>
    </div>
  );
}

function AuthField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        {...props}
        aria-label={label}
        className="h-12 w-full rounded-full border border-black/[0.06] bg-[#F1F1F4] px-5 text-sm text-[#1B1B21] shadow-[0_1px_2px_rgba(16,16,20,0.06)] outline-none placeholder:text-[#8A8A93] focus:border-[#1B1B21]/20 focus:ring-2 focus:ring-[#1B1B21]/10 dark:border-border dark:bg-secondary dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-ring/50 dark:focus:ring-ring/20"
      />
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const t = useT("auth");
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="flex h-12 items-center rounded-full border border-black/[0.06] bg-[#F1F1F4] pe-3 shadow-[0_1px_2px_rgba(16,16,20,0.06)] focus-within:border-[#1B1B21]/20 focus-within:ring-2 focus-within:ring-[#1B1B21]/10 dark:border-border dark:bg-secondary dark:focus-within:border-ring/50 dark:focus-within:ring-ring/20">
        <input
          type={visible ? "text" : "password"}
          aria-label={label}
          placeholder={label}
          required
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="h-full min-w-0 flex-1 rounded-full border-0 bg-transparent px-5 text-sm text-[#1B1B21] outline-none placeholder:text-[#8A8A93] dark:text-foreground dark:placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label={t(visible ? "hidePassword" : "showPassword")}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-[#6E6E77] transition-colors hover:bg-black/5 hover:text-[#1B1B21] dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground"
        >
          <AuthIcon icon={visible ? ViewOffIcon : ViewIcon} size={18} />
        </button>
      </span>
    </label>
  );
}

/**
 * Full-bleed showcase visual for the auth screens: a monumental Louma coin over an
 * aurora backdrop with a slow rotating arc. Pure decoration, out of the a11y tree.
 */
function ShowcaseVisual() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(150deg,#0B1526_0%,#0E3A32_38%,#1B2A52_72%,#120D22_100%)]" />
      <div className="absolute -top-32 start-[8%] size-[420px] rounded-full bg-[#7C5CFF]/30 blur-[130px]" />
      <div className="absolute top-[38%] end-[-10%] size-[460px] rounded-full bg-[#2DD4BF]/25 blur-[130px]" />
      <div className="absolute bottom-[-15%] start-[20%] size-[380px] rounded-full bg-[#4F7CFF]/25 blur-[130px]" />
      <div
        aria-hidden
        className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,0.16)_1.2px,transparent_1.2px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_82%)]"
      />
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative grid size-[340px] place-items-center xl:size-[400px]">
          <div className="absolute inset-6 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.5)_0%,rgba(45,212,191,0.28)_45%,transparent_70%)] blur-2xl" />
          <div className="absolute inset-0 rounded-full border border-white/10" />
          <div className="absolute inset-8 rounded-full border border-white/10" />
          <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(52,211,153,0.9)_70deg,transparent_140deg)] blur-[3px] [mask:radial-gradient(closest-side,transparent_86%,black_87%)] motion-safe:animate-[spin_16s_linear_infinite]" />
          <div className="absolute inset-8 rounded-full bg-[conic-gradient(from_180deg,transparent_0deg,rgba(139,124,255,0.9)_60deg,transparent_130deg)] blur-[3px] [mask:radial-gradient(closest-side,transparent_87%,black_88%)] motion-safe:animate-[spin_26s_linear_infinite_reverse]" />
          <img
            src="/Louma_Brand_logos/png/louma-logo-512x512.png"
            alt=""
            width={256}
            height={256}
            draggable={false}
            className="relative size-52 border-0 bg-transparent object-contain shadow-none drop-shadow-[0_18px_50px_rgba(0,0,0,0.55)] xl:size-60"
          />
          <img
            src="/Louma_Brand_logos/png/louma-logo-128x128.png"
            alt=""
            width={72}
            height={72}
            draggable={false}
            className="absolute end-[2%] top-[6%] size-[72px] border-0 bg-transparent object-contain opacity-90 shadow-none drop-shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
          />
        </div>
      </div>
    </div>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useT("auth");
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center px-6 py-10 sm:px-12">
        <span className="flex items-center gap-2.5">
          <img
            src="/Louma_Brand_logos/png/louma-logo-128x128.png"
            alt={t("logoAlt")}
            width={44}
            height={44}
            draggable={false}
            className="size-11 shrink-0 border-0 bg-transparent object-contain shadow-none"
          />
          <span className="font-display text-2xl font-bold tracking-tight text-foreground">
            Louma
          </span>
        </span>
        <h1 className="mt-8 text-center font-display text-4xl leading-[1.15] font-bold text-foreground">
          {title}
        </h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-8 w-full max-w-[340px]">{children}</div>
        <p className="mt-8 text-center text-[13px] text-muted-foreground">{footer}</p>
      </div>
      <div className="relative hidden overflow-hidden rounded-tl-[24px] lg:block">
        <ShowcaseVisual />
      </div>
    </div>
  );
}

function SubmitButton({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="h-12 w-full cursor-pointer rounded-full bg-shell font-display text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:text-white"
    >
      {children}
    </button>
  );
}

export function LoginContent() {
  const t = useT("auth");
  const checkingSession = useRedirectWhenAuthed();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (pendingSessionId) {
        await completeTwoFactor({ sessionId: pendingSessionId, code });
        setPendingSessionId(null);
        await navigate({ to: "/" });
      } else {
        const response = await login({ email: email.trim(), password });
        if (response.requiresTwoFactor) setPendingSessionId(response.sessionId);
        else await navigate({ to: "/" });
      }
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession) return <AuthSessionCheck />;

  return (
    <AuthShell
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      footer={
        <>
          {t("login.footerQuestion")}{" "}
          <Link to="/signup" className="font-bold text-foreground hover:underline">
            {t("login.footerAction")}
          </Link>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        {pendingSessionId ? (
          <AuthField
            label={t("fields.code")}
            type="text"
            inputMode="numeric"
            maxLength={64}
            required
            value={code}
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value)}
          />
        ) : (
          <>
            <AuthField
              label={t("fields.email")}
              type="email"
              placeholder={t("fields.email")}
              required
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
            <PasswordField
              label={t("fields.password")}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          </>
        )}
        {!pendingSessionId && (
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-muted-foreground hover:underline"
            >
              {t("login.forgot")}
            </Link>
          </div>
        )}
        <SubmitButton disabled={busy}>
          {busy ? t("login.busy") : t(pendingSessionId ? "login.verify" : "login.submit")}
        </SubmitButton>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </AuthShell>
  );
}

export function SignupContent() {
  const t = useT("auth");
  const checkingSession = useRedirectWhenAuthed();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await register({ email: email.trim(), password, displayName: name.trim() });
      await navigate({ to: "/" });
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession) return <AuthSessionCheck />;

  return (
    <AuthShell
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
      footer={
        <>
          {t("signup.footerQuestion")}{" "}
          <Link to="/login" className="font-bold text-foreground hover:underline">
            {t("signup.footerAction")}
          </Link>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <AuthField
          label={t("fields.fullName")}
          type="text"
          placeholder={t("fields.fullName")}
          required
          value={name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        <AuthField
          label={t("fields.email")}
          type="email"
          placeholder={t("fields.email")}
          required
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label={t("fields.password")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <SubmitButton disabled={busy}>{busy ? t("signup.busy") : t("signup.submit")}</SubmitButton>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordContent() {
  const t = useT("auth");
  const checkingSession = useRedirectWhenAuthed();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (checkingSession) return <AuthSessionCheck />;

  return (
    <AuthShell
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
      footer={
        <>
          {t("forgot.footerQuestion")}{" "}
          <Link to="/login" className="font-bold text-foreground hover:underline">
            {t("forgot.footerAction")}
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="rounded-[22px] border bg-card p-6 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-[#1F7A5A] dark:text-emerald-400">
            <AuthIcon icon={CheckmarkCircle01Icon} size={24} />
          </span>
          <p className="mt-4 font-display text-lg font-bold text-foreground">
            {t("forgot.sentTitle")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("forgot.sentBody", { email })}
          </p>
          <Link
            to="/login"
            className={cn(
              "mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full",
              "bg-shell font-display text-[15px] font-semibold text-primary-foreground hover:opacity-90 dark:text-white",
            )}
          >
            <AuthIcon icon={ArrowLeft01Icon} size={18} />
            {t("forgot.back")}
          </Link>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            // The API owns the outcome: until an email provider is configured it refuses the
            // request, and that message is what the visitor is shown.
            void api
              .post<void>(
                "/api/v1/auth/forgot-password",
                { email: email.trim() },
                // Password recovery runs before a session exists, so it carries the pre-session token.
                { auth: false, csrf: "preauth" },
              )
              .then(() => setSent(true))
              .catch((cause: unknown) => setError(messageForError(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <AuthField
            label={t("fields.email")}
            type="email"
            placeholder={t("fields.email")}
            required
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <SubmitButton disabled={busy}>
            {busy ? t("forgot.busy") : t("forgot.submit")}
          </SubmitButton>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </AuthShell>
  );
}
