import { Footer } from "@/components/Footer";
import { Masthead } from "@/components/Masthead";
import { Sleeve } from "@/components/Sleeve";
import { IntakeForm } from "@/components/home/IntakeForm";
import { PresetCard } from "@/components/home/PresetCard";
import { deckSizeLabel } from "@/lib/session/deck";
import { PRESETS } from "@/lib/session/presets";

function SectionHead({ id, title, aside }: { id: string; title: string; aside: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-b border-paper-300 pb-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <h2 id={id} className="text-3xl">
        {title}
      </h2>
      <p className="text-md text-ink-500">{aside}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="wrap flex flex-1 flex-col">
      <Masthead
        centre={<p className="label hidden sm:block">A conversation aid for caregivers · Built on the Qloo taste graph</p>}
        actions={
          <a className="btn-text" href="https://github.com/maikunari/reminisce#why-qloo-is-essential" rel="noreferrer">
            How it uses Qloo
          </a>
        }
      />

      <main id="main" className="flex-1">
        <section className="grid items-center gap-8 py-12 sm:py-16 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12">
          <div>
            <h1 className="balance max-w-[14ch] text-4xl sm:text-5xl">Music and memories from when they were twenty.</h1>
            <p className="lede mt-6 max-w-[40ch]">
              Tell us the year a loved one was born, where they grew up, and a few things they loved. Reminisce asks Qloo what their generation
              and their hometown adored, and sets a table of songs, films, dishes and places to talk about together.
            </p>
            <ol className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-md text-ink-500">
              <li className="flex items-baseline gap-2.5">
                <span className="font-display text-md text-ember-700">1</span>Three facts about them
              </li>
              <li className="flex items-baseline gap-2.5">
                <span className="font-display text-md text-ember-700">2</span>A 20-minute deck of {deckSizeLabel()} cards
              </li>
              <li className="flex items-baseline gap-2.5">
                <span className="font-display text-md text-ember-700">3</span>
                <span>
                  Tap <em>they lit up</em>; the rest follows their lead
                </span>
              </li>
            </ol>
          </div>
          {/* Three pieces of ephemera on a table. Decorative. */}
          <div className="relative mx-auto aspect-square w-full max-w-[420px] md:max-w-none" aria-hidden="true">
            <Sleeve
              domain="music"
              title="Hibari Misora"
              label="45 rpm · Columbia"
              line="Kanashii Sake · 1966"
              className="absolute top-[8%] left-0 aspect-square w-[58%] -rotate-[5deg] border border-paper-300 text-[12px] shadow-lift sm:text-[15px]"
            />
            <Sleeve
              domain="film"
              title="Red Beard"
              label="Nikkatsu"
              line="1965"
              className="absolute top-0 right-0 aspect-square w-1/2 rotate-[4deg] border border-paper-300 text-[12px] shadow-lift sm:text-[15px]"
            />
            <Sleeve
              domain="place"
              title="Dotonbori"
              label="¥10"
              line="Osaka 1968"
              className="absolute bottom-0 left-[24%] aspect-square w-[56%] -rotate-[1.5deg] border border-paper-300 text-[12px] shadow-lift sm:text-[15px]"
            />
          </div>
        </section>

        <section aria-labelledby="begin-heading">
          <SectionHead id="begin-heading" title="Begin with someone we prepared" aside="Two people, two decades, two cities." />
          <div className="grid gap-6 md:grid-cols-2">
            {PRESETS.map((preset) => (
              <PresetCard key={preset.id} preset={preset} />
            ))}
          </div>
        </section>

        <section aria-labelledby="make-heading" className="mt-12 sm:mt-16">
          <SectionHead id="make-heading" title="Or make one for someone you love" aside="About a minute." />
          <IntakeForm />
        </section>
      </main>
      <Footer />
    </div>
  );
}
