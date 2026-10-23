import Link from "next/link";

import { Brand } from "./Brand";

const navigation = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#value", label: "What we’re building" },
  { href: "#builder", label: "Solution builder" },
];

export function SiteHeader() {
  return (
    <header className="site-header landing-header">
      <div className="page-width header-inner">
        <div className="header-brand">
          <Brand />
        </div>
        <div className="header-navigation">
          <nav className="header-nav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="header-actions">
          <span className="header-phase" aria-label="Current product phase">
            <span className="status-dot" aria-hidden="true" />
            Phase 2
          </span>
          <Link className="button button-small button-primary" href="#builder">
            Start building
            <span aria-hidden="true">↗</span>
          </Link>
          <details className="mobile-menu">
            <summary aria-label="Open navigation menu">
              <span aria-hidden="true">Menu</span>
              <span className="menu-dots" aria-hidden="true">
                •••
              </span>
            </summary>
            <nav aria-label="Mobile navigation">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
