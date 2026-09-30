import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight02Icon, Plug01Icon } from '@hugeicons/core-free-icons';
import { categories, stats } from './data';
import { IntegrationLogo } from './components/integration-logo';
import { createMetadata } from '@/lib/metadata';

export const metadata = createMetadata({
  title: 'Connected Services',
  description:
    'Louma connected services for networks, settlement, and wallet tools.',
  path: '/sponsors',
});

export default function Page() {
  const featuredIntegrations = categories.flatMap((category) => category.integrations).slice(0, 6);

  return (
    <main className="relative z-2 mx-auto w-full max-w-page px-4 pb-12 md:py-12">
      <section className="relative dark mb-6 min-h-[420px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#070707] p-6 shadow-2xl md:p-12">
        <div className="absolute inset-0 -z-1 bg-[linear-gradient(135deg,rgba(255,243,131,.24),transparent_32%),radial-gradient(circle_at_84%_18%,rgba(252,119,68,.32),transparent_30%),linear-gradient(180deg,rgba(255,255,255,.08),transparent)]" />
        <div className="absolute inset-0 -z-1 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:72px_72px]" />
        <div className="grid min-h-[324px] gap-8 md:grid-cols-[minmax(0,1fr)_420px] md:items-end">
          <div className="flex max-w-3xl flex-col justify-end">
            <h1 className="text-4xl font-semibold tracking-normal text-white md:text-6xl">
              Services that keep your wallet connected
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/68 md:text-lg">
              Louma connects the services you already use for networks, settlement, and insights into
              one place for calmer daily use.
            </p>

            <div className="mt-8 grid w-full max-w-xl grid-cols-2 overflow-hidden rounded-2xl border border-white/12 bg-white/8 text-start shadow-2xl backdrop-blur">
              {stats.map(([value, label]) => (
                <div key={label} className="border-e border-white/12 p-4 last:border-e-0">
                  <p className="text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-xs text-white/58">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:gap-4">
            {featuredIntegrations.map((integration, index) => (
              <div
                key={integration.name}
                className="group flex min-h-32 flex-col justify-between rounded-3xl border border-white/12 bg-white/[.07] p-4 shadow-2xl backdrop-blur transition-colors hover:bg-white/[.12]"
              >
                <div className="flex items-start justify-between gap-3">
                  <IntegrationLogo integration={integration} />
                  <span className="rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white/68">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <p className="mt-5 text-sm font-medium text-white">{integration.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-5">
        {categories.map((category) => (
          <div
            key={category.title}
            className="grid gap-4 overflow-hidden rounded-3xl border bg-fd-card/80 p-4 shadow-sm backdrop-blur md:grid-cols-[280px_1fr]"
          >
            <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-fd-secondary/60 p-5">
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-fd-foreground/20 to-transparent" />
              <div>
                <HugeiconsIcon
                  icon={category.icon}
                  size={34}
                  strokeWidth={2}
                  className="text-fd-foreground"
                />
                <h2 className="mt-5 text-2xl font-semibold">{category.title}</h2>
                <p className="mt-2 text-sm text-fd-muted-foreground">{category.description}</p>
              </div>
              <div className="mt-8 flex items-center gap-2 text-xs font-medium text-fd-muted-foreground">
                <HugeiconsIcon icon={Plug01Icon} size={16} strokeWidth={2} />
                <span>{category.integrations.length} services</span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {category.integrations.map((integration) => (
                <article
                  key={integration.name}
                  className="group flex min-h-52 flex-col justify-between rounded-2xl border bg-fd-card p-5 shadow-sm transition-colors hover:bg-fd-accent/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <IntegrationLogo integration={integration} />
                    <span className="rounded-full bg-fd-background/80 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
                      {integration.status}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xl font-semibold">{integration.name}</h3>
                      <HugeiconsIcon
                        icon={ArrowRight02Icon}
                        size={18}
                        strokeWidth={2}
                        className="text-fd-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                      {integration.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
