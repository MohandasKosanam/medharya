import Link from "next/link";

import { SolutionBuilder } from "@/components/builder/SolutionBuilder";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

const steps = [
  {
    number: "01",
    title: "Describe your idea.",
    copy: "Start with the outcome you care about, the people you want to help, and the problem worth solving.",
  },
  {
    number: "02",
    title: "Explore the trade-offs.",
    copy: "Understand which technologies fit your context, budget, experience, and the direction you want to take.",
  },
  {
    number: "03",
    title: "Follow a practical plan.",
    copy: "Move from a promising idea to a clear next step, with a roadmap you can actually start building.",
  },
];

const valuePropositions = [
  {
    icon: "01",
    title: "A stack with context",
    copy: "Recommendations should explain why a tool fits—not just name a popular framework. This decision layer is being built for Phase 2.",
    status: "In development",
  },
  {
    icon: "02",
    title: "Budget-aware choices",
    copy: "Keep the user’s budget and cost drivers visible from the start, without pretending to have live pricing in this prototype.",
    status: "Foundation ready",
  },
  {
    icon: "03",
    title: "Compatibility awareness",
    copy: "Surface the practical connections and limitations between tools before they become expensive detours.",
    status: "In development",
  },
  {
    icon: "04",
    title: "Guidance you can use",
    copy: "Turn decisions into an implementation sequence that helps a student, freelancer, or small team make progress.",
    status: "In development",
  },
];

export default function Home() {
  return (
    <div className="app-shell">
      <SiteHeader />

      <main>
        <section className="hero-section">
          <div className="page-width hero-grid">
            <div className="hero-copy">
              <p className="eyebrow hero-eyebrow">
                <span className="eyebrow-pulse" aria-hidden="true" />
                Solution building, not guesswork
              </p>
              <h1>
                Big ideas deserve a <em>smarter start.</em>
              </h1>
              <p className="hero-description">
                Turn your idea into a practical technology stack, a budget-aware
                plan, and a step-by-step roadmap. Less guesswork. More building.
              </p>
              <div className="hero-actions">
                <Link className="button button-primary button-large" href="#builder">
                  Build my solution
                  <span aria-hidden="true">↗</span>
                </Link>
                <Link className="text-link" href="#how-it-works">
                  Explore how it works
                  <span aria-hidden="true">↓</span>
                </Link>
              </div>
              <div className="hero-note">
                <span className="hero-note-icon" aria-hidden="true">✦</span>
                <p>Phase 2 is live: capture your brief, open a workspace, and make decisions with context.</p>
              </div>
            </div>

            <div className="hero-visual" aria-label="A preview of the Medharya solution-building process">
              <div className="visual-orbit orbit-one" aria-hidden="true" />
              <div className="visual-orbit orbit-two" aria-hidden="true" />
              <div className="solution-preview-card">
                <div className="preview-card-topline">
                  <span className="preview-kicker">Your solution brief</span>
                  <span className="preview-dots" aria-hidden="true">•••</span>
                </div>
                <div className="preview-title-block">
                  <span className="preview-label">Start with the signal</span>
                  <strong>Idea → context → direction</strong>
                </div>
                <div className="preview-flow" aria-hidden="true">
                  <div className="flow-node flow-node-active">
                    <span>01</span>
                    <small>What you want to make</small>
                  </div>
                  <div className="flow-line" />
                  <div className="flow-node">
                    <span>02</span>
                    <small>What it needs to work</small>
                  </div>
                  <div className="flow-line" />
                  <div className="flow-node">
                    <span>03</span>
                    <small>What to do next</small>
                  </div>
                </div>
                <div className="preview-footer">
                  <span className="preview-status"><i aria-hidden="true" />Structured input</span>
                  <span>Phase 1</span>
                </div>
              </div>
              <div className="floating-label label-context"><span aria-hidden="true">⌁</span> Context first</div>
              <div className="floating-label label-clarity"><span aria-hidden="true">✦</span> Built for clarity</div>
            </div>
          </div>
          <div className="hero-glow hero-glow-one" aria-hidden="true" />
          <div className="hero-glow hero-glow-two" aria-hidden="true" />
        </section>

        <section className="signal-strip" aria-label="Medharya principles">
          <div className="page-width signal-strip-inner">
            <span>For students</span>
            <span className="signal-separator" aria-hidden="true">✦</span>
            <span>For builders</span>
            <span className="signal-separator" aria-hidden="true">✦</span>
            <span>For practical decisions</span>
            <span className="signal-separator" aria-hidden="true">✦</span>
            <span>Made in India, built for anywhere</span>
          </div>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="page-width">
            <div className="section-heading how-heading">
              <div>
                <p className="eyebrow">The Medharya way</p>
                <h2 id="how-title">Clarity before complexity.</h2>
              </div>
              <p>
                The right solution rarely starts with a random list of tools. It
                starts with understanding what you&apos;re actually trying to do.
              </p>
            </div>
            <div className="steps-grid">
              {steps.map((step, index) => (
                <article className={`step-card${index === 1 ? " step-card-featured" : ""}`} key={step.number}>
                  <div className="step-number">{step.number}</div>
                  <div className="step-card-copy">
                    <h3>{step.title}</h3>
                    <p>{step.copy}</p>
                  </div>
                  <span className="step-arrow" aria-hidden="true">↗</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="value-section" id="value" aria-labelledby="value-title">
          <div className="page-width">
            <div className="value-intro">
              <p className="eyebrow">More than a directory</p>
              <h2 id="value-title">Useful decisions, made visible.</h2>
              <p>
                Medharya is being shaped to sit between a blank canvas and a
                confident build plan—helping you see the reasoning behind the
                path forward.
              </p>
            </div>
            <div className="value-grid">
              {valuePropositions.map((value) => (
                <article className="value-card" key={value.title}>
                  <div className="value-card-topline">
                    <span className="value-icon">{value.icon}</span>
                    <span className="value-status">{value.status}</span>
                  </div>
                  <h3>{value.title}</h3>
                  <p>{value.copy}</p>
                  <span className="card-rule" aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <SolutionBuilder />
      </main>

      <SiteFooter />
    </div>
  );
}
