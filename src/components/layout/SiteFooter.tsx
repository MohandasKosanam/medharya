import Link from "next/link";

import { Brand } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="site-footer landing-footer">
      <div className="page-width footer-inner">
        <div className="footer-brand">
          <Brand showTagline />
          <p className="footer-note">
            A practical starting point for turning ideas into buildable solutions.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer navigation">
          <Link href="#how-it-works">How it works</Link>
          <Link href="#value">What we’re building</Link>
          <Link href="#builder">Solution builder</Link>
        </nav>
        <div className="footer-meta">
          <p className="footer-status">
            <span className="status-dot" aria-hidden="true" />
            Phase 2 prototype · Local project workspace is live
          </p>
        </div>
      </div>
    </footer>
  );
}
