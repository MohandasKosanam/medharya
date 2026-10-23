"use client";

import Link from "next/link";

import { Brand } from "@/components/layout/Brand";
import { WorkspaceAccountStatus } from "@/components/workspace/WorkspaceAccountStatus";
import type { ProjectWorkspace } from "@/types/workspace";

export type WorkspaceView = "glance" | "chat" | "branches" | "connection";

type WorkspaceNavigationProps = {
  workspace: ProjectWorkspace;
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  selectedBranchId: string | null;
  serverBacked: boolean;
};

const navigationItems: Array<{ id: WorkspaceView; label: string; description: string; symbol: string }> = [
  { id: "glance", label: "Quick Glance", description: "Project context and plan", symbol: "⌂" },
  { id: "chat", label: "Chat", description: "Think with Medharya", symbol: "◌" },
  { id: "branches", label: "Branches", description: "Ideas and execution", symbol: "⌘" },
  { id: "connection", label: "Node Connection", description: "Map explicit relationships", symbol: "⌁" },
];

export function WorkspaceNavigation({
  workspace,
  activeView,
  onViewChange,
  selectedBranchId,
  serverBacked,
}: WorkspaceNavigationProps) {
  const operatingSystem = workspace.operatingSystem;
  const activeBranchCount = operatingSystem?.branches.filter((branch) => branch.status === "active").length ?? 0;
  const relationshipCount = operatingSystem?.edges.filter((edge) => edge.status === "active").length ?? 0;
  const selectedBranch = operatingSystem?.branches.find((branch) => branch.id === selectedBranchId);

  return (
    <aside className="workspace-sidebar" aria-label="Project navigation">
      <div className="workspace-sidebar-header">
        <Brand href="/" />
        <span className="workspace-sidebar-label">Workspace</span>
      </div>

      <div className="workspace-sidebar-project" aria-label="Current project">
        <span className="workspace-sidebar-kicker">Project</span>
        <strong>{workspace.name}</strong>
        <small>{workspace.request.category}</small>
      </div>

      <nav className="workspace-sidebar-nav" aria-label="Workspace views">
        <span className="workspace-sidebar-section-label">Navigate</span>
        {navigationItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              className={`workspace-sidebar-nav-item${isActive ? " is-active" : ""}`}
              type="button"
              key={item.id}
              onClick={() => onViewChange(item.id)}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="workspace-sidebar-nav-symbol" aria-hidden="true">{item.symbol}</span>
              <span className="workspace-sidebar-nav-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="workspace-sidebar-status" aria-label="Project status">
        <span className="workspace-sidebar-section-label">Project signal</span>
        <div className="workspace-sidebar-status-row"><span>Active branches</span><strong>{activeBranchCount}</strong></div>
        <div className="workspace-sidebar-status-row"><span>Connections</span><strong>{relationshipCount}</strong></div>
        <div className="workspace-sidebar-status-row"><span>Persistence</span><strong>{serverBacked ? "Synced" : "Local"}</strong></div>
        {selectedBranch ? <p className="workspace-sidebar-selection">Selected node · {selectedBranch.name}</p> : null}
      </div>

      <div className="workspace-sidebar-footer">
        <WorkspaceAccountStatus />
        <Link className="workspace-sidebar-home-link" href="/">Back to Medharya <span aria-hidden="true">↗</span></Link>
      </div>
    </aside>
  );
}
