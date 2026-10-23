type EffectProps = {
  className?: string;
};

const fireParticles = [
  { className: "fire-particle fire-particle-one", symbol: "✦" },
  { className: "fire-particle fire-particle-two", symbol: "·" },
  { className: "fire-particle fire-particle-three", symbol: "✧" },
  { className: "fire-particle fire-particle-four", symbol: "·" },
];

const ashParticles = [
  "ash-particle-one",
  "ash-particle-two",
  "ash-particle-three",
  "ash-particle-four",
  "ash-particle-five",
  "ash-particle-six",
];

const pixelDots = Array.from({ length: 12 }, (_, index) => index);

export function Fire({ className = "" }: EffectProps) {
  return (
    <span className={`effect-fire ${className}`.trim()} aria-hidden="true">
      <span className="fire-core" />
      {fireParticles.map((particle) => (
        <span className={particle.className} key={particle.className}>
          {particle.symbol}
        </span>
      ))}
    </span>
  );
}

export function Ash({ className = "" }: EffectProps) {
  return (
    <span className={`effect-ash ${className}`.trim()} aria-hidden="true">
      {ashParticles.map((particle) => (
        <span className={particle} key={particle} />
      ))}
    </span>
  );
}

export function PixelDots({ className = "" }: EffectProps) {
  return (
    <span className={`effect-pixel-dots ${className}`.trim()} aria-hidden="true">
      {pixelDots.map((index) => (
        <span key={index} />
      ))}
    </span>
  );
}
