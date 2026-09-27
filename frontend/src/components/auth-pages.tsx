import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CheckmarkCircle01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { demoLogin, isAuthed } from "@/lib/demo-auth";
import { DEMO_USER_EMAIL } from "@/lib/demo-wallet";
import { cn } from "@/lib/utils";

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
 * Sends an already-signed-in visitor straight to the dashboard, so the auth
 * screens never flash for someone with a remembered demo session.
 */
function useRedirectWhenAuthed() {
  const navigate = useNavigate();
  useEffect(() => {
    if (isAuthed()) {
      void navigate({ to: "/" });
    }
  }, [navigate]);
}

/**
 * Official multicolor Google "G" mark (brand asset, inline so it stays sharp
 * at any size without an extra request).
 */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function GoogleSignIn({ onClick }: { onClick: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-[#DFDFE6] bg-white text-sm font-semibold text-[#1B1B21] transition-colors hover:bg-[#F5F5F7]"
      >
        <GoogleMark />
        Continue with Google
      </button>
      <div className="my-6 flex items-center gap-4 text-xs text-[#8A8A93]">
        <span className="h-px flex-1 bg-[#E4E4E9]" />
        or
        <span className="h-px flex-1 bg-[#E4E4E9]" />
      </div>
    </>
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
        className="h-12 w-full rounded-full border border-black/[0.06] bg-[#F1F1F4] px-5 text-sm text-[#1B1B21] shadow-[0_1px_2px_rgba(16,16,20,0.06)] outline-none placeholder:text-[#8A8A93] focus:border-[#1B1B21]/20 focus:ring-2 focus:ring-[#1B1B21]/10"
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
  const [visible, setVisible] = useState(false);
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="flex h-12 items-center rounded-full border border-black/[0.06] bg-[#F1F1F4] pe-3 shadow-[0_1px_2px_rgba(16,16,20,0.06)] focus-within:border-[#1B1B21]/20 focus-within:ring-2 focus-within:ring-[#1B1B21]/10">
        <input
          type={visible ? "text" : "password"}
          aria-label={label}
          placeholder={label}
          required
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="h-full min-w-0 flex-1 rounded-full border-0 bg-transparent px-5 text-sm text-[#1B1B21] outline-none placeholder:text-[#8A8A93]"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-[#6E6E77] transition-colors hover:bg-black/5 hover:text-[#1B1B21]"
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
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center px-6 py-10 sm:px-12">
        <span className="flex items-center gap-2.5">
          <img
            src="/Louma_Brand_logos/png/louma-logo-128x128.png"
            alt="Louma logo"
            width={44}
            height={44}
            draggable={false}
            className="size-11 shrink-0 border-0 bg-transparent object-contain shadow-none"
          />
          <span className="font-display text-2xl font-bold tracking-tight text-[#14141A]">
            Louma
          </span>
        </span>
        <h1 className="mt-8 text-center font-display text-4xl leading-[1.15] font-bold text-[#101014]">
          {title}
        </h1>
        <p className="mt-3 text-center text-sm text-[#6E6E77]">{subtitle}</p>
        <div className="mt-8 w-full max-w-[340px]">{children}</div>
        <p className="mt-8 text-center text-[13px] text-[#6E6E77]">{footer}</p>
      </div>
      <div className="relative hidden overflow-hidden rounded-l-[24px] lg:block">
        <ShowcaseVisual />
      </div>
    </div>
  );
}

function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="h-12 w-full cursor-pointer rounded-full bg-shell font-display text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      {children}
    </button>
  );
}

export function LoginContent() {
  useRedirectWhenAuthed();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const enter = (value: string) => {
    demoLogin(value.trim() === "" ? DEMO_USER_EMAIL : value);
    void navigate({ to: "/" });
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your Louma wallet."
      footer={
        <>
          New to Louma?{" "}
          <Link to="/signup" className="font-bold text-[#101014] hover:underline">
            Create account
          </Link>
        </>
      }
    >
      <GoogleSignIn onClick={() => enter(DEMO_USER_EMAIL)} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          enter(email);
        }}
      >
        <AuthField
          label="Email"
          type="email"
          placeholder="Email"
          required
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-xs font-semibold text-[#6E6E77] hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <SubmitButton>Log in</SubmitButton>
      </form>
    </AuthShell>
  );
}

export function SignupContent() {
  useRedirectWhenAuthed();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const enter = (value: string) => {
    demoLogin(value.trim() === "" ? DEMO_USER_EMAIL : value);
    void navigate({ to: "/" });
  };

  return (
    <AuthShell
      title="Start your wallet journey"
      subtitle="Create your Louma account in seconds."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-bold text-[#101014] hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <GoogleSignIn onClick={() => enter(DEMO_USER_EMAIL)} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          enter(email);
        }}
      >
        <AuthField
          label="Full name"
          type="text"
          placeholder="Full name"
          required
          value={name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        <AuthField
          label="Email"
          type="email"
          placeholder="Email"
          required
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <SubmitButton>Start</SubmitButton>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordContent() {
  useRedirectWhenAuthed();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <AuthShell
      title="Reset password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="font-bold text-[#101014] hover:underline">
            Back to log in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="rounded-[22px] bg-[#F1F1F4] p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-[#1F7A5A]">
            <AuthIcon icon={CheckmarkCircle01Icon} size={24} />
          </span>
          <p className="mt-4 font-display text-lg font-bold text-[#101014]">Check your inbox</p>
          <p className="mt-2 text-sm leading-relaxed text-[#6E6E77]">
            If an account exists for <strong className="text-[#101014]">{email}</strong>, a reset
            link is on its way.
          </p>
          <Link
            to="/login"
            className={cn(
              "mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full",
              "bg-shell font-display text-[15px] font-semibold text-primary-foreground hover:opacity-90",
            )}
          >
            <AuthIcon icon={ArrowLeft01Icon} size={18} />
            Back to log in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <AuthField
            label="Email"
            type="email"
            placeholder="Email"
            required
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <SubmitButton>Send reset link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
