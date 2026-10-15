import Link from "next/link";

import { Brand } from "./Brand";

const navigation = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#value", label: "What we’re building" },
  { href: "#builder", label: "Solution builder" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-width header-inner">
        <Brand />
        <nav className="header-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link className="button button-small button-primary" href="#builder">
            Build my solution
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
