import { Masthead } from "@/components/Masthead";

export default function HomeMasthead() {
  return (
    <div className="wrap">
      <Masthead
        centre={<p className="label hidden sm:block">A conversation aid for caregivers · Built on the Qloo taste graph</p>}
        actions={
          <a className="btn-text" href="https://github.com/maikunari/reminisce#why-qloo-is-essential" rel="noreferrer">
            How it uses Qloo
          </a>
        }
      />
    </div>
  );
}
