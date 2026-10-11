import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { IntakeForm } from "@/components/home/IntakeForm";
import { PresetCard } from "@/components/home/PresetCard";
import { RecentSessions } from "@/components/home/RecentSessions";
import { PRESETS } from "@/lib/session/presets";

export default function HomePage() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pt-6 sm:px-8">
        <Logo />
        <a
          href="https://github.com/maikunari/reminisce#why-qloo-is-essential"
          rel="noreferrer"
          className="hidden rounded-full border-2 border-cream-300 bg-white px-4 py-2 text-base font-bold text-ink-700 hover:border-ember-600 hover:text-ember-700 sm:inline-flex"
        >
          How it uses Qloo
        </a>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <section className="animate-rise pt-12 pb-10 sm:pt-20">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-ember-100 px-4 py-1.5 text-base font-bold text-ember-700">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-ember-600" aria-hidden="true" />
            For family caregivers and care-home activity staff
          </p>
          <h1 className="max-w-4xl font-display text-5xl leading-[1.05] font-semibold tracking-tight text-ink-900 sm:text-7xl">
            Music and memories from when they were&nbsp;<em className="text-ember-600">20</em>.
          </h1>
          <p className="mt-6 max-w-3xl text-xl leading-relaxed text-ink-700 sm:text-2xl">
            Tell us a loved one&apos;s birth year, where they grew up, and a few things they loved. Reminisce asks the Qloo taste graph what
            <em> their</em> generation and hometown adored, then builds a 20-minute conversation of songs, films, dishes and places, each with a
            gentle prompt. It re-tunes live as you tap <strong>they lit up</strong> or <strong>not this one</strong>.
          </p>
        </section>

        <section aria-labelledby="try-heading" className="animate-rise [animation-delay:120ms]">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 id="try-heading" className="font-display text-3xl font-semibold text-ink-900">
              Try it in one tap
            </h2>
            <p className="hidden text-base text-ink-500 sm:block">Two people, two decades, two worlds.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {PRESETS.map((preset) => (
              <PresetCard key={preset.id} preset={preset} />
            ))}
          </div>
        </section>

        <section aria-labelledby="intake-heading" className="animate-rise mt-16 [animation-delay:200ms]">
          <div className="mb-5">
            <h2 id="intake-heading" className="font-display text-3xl font-semibold text-ink-900">
              Or build one for someone you love
            </h2>
            <p className="mt-2 text-lg text-ink-500">Takes about a minute. Favorites are matched against Qloo&apos;s entity search as you type.</p>
          </div>
          <IntakeForm />
        </section>

        <RecentSessions />
      </main>
      <Footer />
    </>
  );
}
