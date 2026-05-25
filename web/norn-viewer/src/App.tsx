import { NornViewer } from "./lib/NornViewer";
import { mockNornGraphState } from "./lib/mock-state";

export function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        background:
          "radial-gradient(circle at top left, rgba(30, 58, 138, 0.32), transparent 38%), radial-gradient(circle at top right, rgba(190, 24, 93, 0.24), transparent 34%), linear-gradient(180deg, #071019 0%, #0c1726 52%, #10131c 100%)",
        color: "#e5eef8",
        fontFamily: '"Aptos", "Segoe UI Variable Text", "Bahnschrift", sans-serif',
      }}
    >
      <section
        style={{
          padding: "28px 28px 18px",
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            width: "fit-content",
            padding: "7px 12px",
            borderRadius: 999,
            background: "rgba(12, 19, 35, 0.72)",
            border: "1px solid rgba(103, 232, 249, 0.28)",
            color: "#9dd7ea",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          EpiphanyAgent Graph Mock
        </div>
        <div style={{ maxWidth: 960, display: "grid", gap: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2rem, 3vw, 3.2rem)",
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            Typed graphs, now with less ceremonial SVG corpse handling.
          </h1>
          <p
            style={{
              margin: 0,
              color: "rgba(229, 238, 248, 0.72)",
              maxWidth: 900,
              fontSize: "1rem",
              lineHeight: 1.55,
            }}
          >
            This demo uses mocked Epiphany state shaped like the current protocol:
            architecture graph, dataflow graph, and typed cross-links between them.
            Zoom in and the details stop hiding under the floorboards.
          </p>
        </div>
      </section>
      <section style={{ padding: "0 20px 20px" }}>
        <NornViewer
          state={mockNornGraphState}
          layoutMode="combined-force"
          motion={{ strength: 1.08, flow: 1.1, orbit: 0.82, lift: 0.9 }}
          performance="fast"
        />
      </section>
    </main>
  );
}
