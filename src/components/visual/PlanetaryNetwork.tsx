type PlanetaryNetworkProps = {
  className?: string;
};

const networkNodes = [
  { className: "planetary-node-idea", label: "Idea" },
  { className: "planetary-node-context", label: "Context" },
  { className: "planetary-node-direction", label: "Direction" },
  { className: "planetary-node-workspace", label: "Workspace" },
];

export function PlanetaryNetwork({ className = "" }: PlanetaryNetworkProps) {
  return (
    <div className={`planetary-network ${className}`.trim()} aria-hidden="true">
      <div className="planetary-network-orbit planetary-network-orbit-wide" />
      <div className="planetary-network-orbit planetary-network-orbit-tall" />
      <div className="planetary-network-orbit planetary-network-orbit-tilted" />

      <svg
        className="planetary-network-lines"
        viewBox="0 0 520 420"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M260 210 92 86" />
        <path d="M260 210 432 99" />
        <path d="M260 210 436 326" />
        <path d="M260 210 83 328" />
        <path d="M92 86 432 99" />
        <path d="M83 328 436 326" />
      </svg>

      <div className="planetary-core">
        <span className="planetary-core-glow" />
        <span className="planetary-core-ring" />
        <span className="planetary-core-label">Medharya</span>
      </div>

      {networkNodes.map((node) => (
        <div className={`planetary-node ${node.className}`} key={node.label}>
          <span className="planetary-node-dot" />
          <span className="planetary-node-label">{node.label}</span>
        </div>
      ))}
    </div>
  );
}
