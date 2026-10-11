export default function Loading() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8" aria-busy="true">
      <div className="skeleton h-10 w-64 rounded-xl" />
      <div className="skeleton mt-8 h-[28rem] rounded-card" />
    </main>
  );
}
