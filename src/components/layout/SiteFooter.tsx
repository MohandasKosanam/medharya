import Link from "next/link";

import { Brand } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-width footer-inner">
        <div>
          <Brand showTagline />
          <p className="footer-note">
            A practical starting point for turning ideas into buildable solutions.
          </p>
        </div>
        <div className="footer-links" aria-label="Footer navigation">
          <Link href="#how-it-works">How it works</Link>
          <Link href="#value">What we’re building</Link>
          <Link href="#builder">Solution builder</Link>
        </div>
        <p className="footer-status">
          <span className="status-dot" aria-hidden="true" />
          Phase 2 prototype · Local project workspace is live
        </p>
      </div>
    </footer>
  );
}
