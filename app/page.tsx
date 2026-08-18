export default function Home() {
  return (
    <main className="site-shell">
      <section
        className="viewer-frame"
        aria-label="Visor consolidado de monto codificado por direcciones"
      >
        <iframe
          src="/published-viewer.html"
          title="Visor consolidado de monto codificado por direcciones"
        />
      </section>
    </main>
  );
}
