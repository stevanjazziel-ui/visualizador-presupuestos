export default function Home() {
  return (
    <main className="site-shell">
      <section className="hero">
        <p className="eyebrow">Consulta presupuestaria</p>
        <h1>Monto codificado por partida larga</h1>
        <p className="lede">
          Dirección General de Gestión de Avalúos y Catastros y SIG. El visor
          resume únicamente las filas de partida con código largo y ordena la
          columna de monto codificado de mayor a menor.
        </p>
      </section>

      <section className="viewer-frame" aria-label="Visor de partidas de Avalúos">
        <iframe
          src="/published-viewer.html"
          title="Visor de monto codificado de Avalúos"
        />
      </section>
    </main>
  );
}
