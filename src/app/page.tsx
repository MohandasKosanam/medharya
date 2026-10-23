import Link from "next/link";

import { SolutionBuilder } from "@/components/builder/SolutionBuilder";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Ash, PixelDots } from "@/components/visual/DecorativeEffects";
import { PlanetaryNetwork } from "@/components/visual/PlanetaryNetwork";

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
    copy: "Recommendations now start from a curated catalogue and expose reasoning, alternatives, uncertainty, and open questions for review.",
    status: "Catalogue baseline",
  },
  {
    icon: "02",
    title: "Budget-aware choices",
    copy: "Keep the user’s budget and cost drivers visible from the start, without pretending to have live pricing in this prototype.",
    status: "Reviewable",
  },
  {
    icon: "03",
    title: "Compatibility awareness",
    copy: "Surface known catalogue conflicts and flag runtime compatibility as an area that still needs verification.",
    status: "Rules active",
  },
  {
    icon: "04",
    title: "Guidance you can use",
    copy: "Turn approved direction into progressive discovery questions, branch context, task drafts, and a roadmap you can inspect.",
    status: "Workspace active",
  },
];

export default function Home() {
  return (
    <div className="app-shell landing-page">
      <SiteHeader />

      <main className="landing-main">
        <section
          className="hero-section landing-hero"
          aria-labelledby="landing-hero-title"
        >
          <div className="landing-hero-backdrop" aria-hidden="true" />
          <div className="page-width hero-grid landing-hero-grid">
            <div className="hero-copy landing-hero-copy">
              <div className="hero-copy-kicker">
                <p className="eyebrow hero-eyebrow">
                  <span className="eyebrow-pulse" aria-hidden="true" />
                  Your ideas deserve a clearer path
                </p>
                <span className="hero-copy-index" aria-hidden="true">01 / 03</span>
              </div>
                <h1 id="landing-hero-title">
                  <span>From idea to</span>
                  <em>execution.</em>
                </h1>
                <p className="hero-description">
                  Medharya helps you structure your ideas, explore decisions with
                  AI, and take clear steps towards execution.
                </p>
                <div className="hero-actions">
                  <Link className="button button-primary button-large" href="#builder">
                  Start building
                  <span aria-hidden="true">↗</span>
                  </Link>
                  <Link className="text-link" href="#how-it-works">
                  Learn more
                  <span aria-hidden="true">↓</span>
                  </Link>
                </div>
                <div className="hero-note">
                  <span className="hero-note-icon" aria-hidden="true">✦</span>
                  <p>
                  A clearer today. A bigger tomorrow.
                  </p>
                </div>
            </div>

            <div
              className="hero-visual landing-hero-focal"
              role="img"
              aria-label="A planetary map showing an idea becoming context, direction, and a project workspace"
            >
              <PixelDots className="hero-pixel-dots" />
              <div className="visual-orbit orbit-one" aria-hidden="true" />
              <div className="visual-orbit orbit-two" aria-hidden="true" />
              <PlanetaryNetwork className="hero-network" />
              <div className="floating-label label-context"><span aria-hidden="true">✦</span> Structure ideas</div>
              <div className="floating-label label-clarity"><span aria-hidden="true">↗</span> Move to execution</div>
              <div className="floating-label label-options"><span aria-hidden="true">⌁</span> Explore options</div>
              <div className="hero-focal-caption">
                <span className="hero-focal-caption-line" aria-hidden="true" />
                <span>One brief. A clearer direction.</span>
              </div>
              <Ash className="hero-ash" />
            </div>
          </div>
          <div className="hero-glow hero-glow-one" aria-hidden="true" />
          <div className="hero-glow hero-glow-two" aria-hidden="true" />
        </section>

        <section className="signal-strip landing-signal-strip" aria-label="Medharya principles">
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

        <section className="how-section landing-section" id="how-it-works" aria-labelledby="how-title">
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

        <section className="value-section landing-section" id="value" aria-labelledby="value-title">
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
