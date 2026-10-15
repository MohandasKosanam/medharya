import Link from "next/link";

type BrandProps = {
  href?: string;
  showTagline?: boolean;
};

export function Brand({ href = "/", showTagline = false }: BrandProps) {
  return (
    <Link className="brand" href={href} aria-label="Medharya home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M7 22.5 12.6 9l3.4 8.1L19.4 9 25 22.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 23.5h14"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="16" cy="6.8" r="2" fill="currentColor" />
        </svg>
      </span>
      <span className="brand-copy">
        <span className="brand-name">Medharya</span>
        {showTagline ? <span className="brand-tagline">Intelligence, Made Useful.</span> : null}
      </span>
    </Link>
  );
}
