import "server-only";

// ---------------------------------------------------------------------------
// Scoped remediation
//
// A remediation action may only address the finding classes and artifact scope
// named in the activated mandate — "fix findings" is not a valid open-ended
// action. Anything outside that named scope is an out-of-mandate expansion and
// becomes a typed CEO-input request, never silent work. A remediation mutation
// also invalidates prior verification, and the verifier that produced a finding
// may never be the route that repairs it (independence).
// ---------------------------------------------------------------------------

export interface RemediationNodeView {
  node_id: string;
  action_role: string;
  remediation_scope: { finding_classes: string[]; artifact_scope: string[] } | null;
}

export type RemediationCycle =
  | { kind: "in_scope"; scope: { finding_classes: string[]; artifact_scope: string[] } }
  // The plan enumerates expansion kinds distinctly ("route, capability, workspace, objective,
  // acceptance, budget, or external-effect expansion"), so the request must name the decision the CEO
  // is actually being asked to make: widening the artifact scope is a workspace change, while
  // addressing an unnamed finding class is a capability change.
  | { kind: "expansion"; decision_type: "capability_change" | "workspace_change" };

// Minimal glob containment: a trailing `/**` matches any path beneath the
// prefix; any other pattern matches only an identical path.
function pathWithinScope(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    return path === pattern;
  });
}

export function buildRemediationCycle(
  node: RemediationNodeView,
  requested: { finding_classes: string[]; artifact_scope: string[] },
): RemediationCycle {
  const named = node.remediation_scope;
  if (node.action_role !== "remediate" || named === null) throw new Error("Only a remediation action with a bounded named scope can run a remediation cycle.");
  if (requested.finding_classes.length === 0 || requested.artifact_scope.length === 0) {
    throw new Error("A remediation cycle must name a bounded, non-empty finding and artifact scope.");
  }

  const findingsInScope = requested.finding_classes.every((finding) => named.finding_classes.includes(finding));
  const artifactsInScope = requested.artifact_scope.every((path) => pathWithinScope(path, named.artifact_scope));
  if (!findingsInScope || !artifactsInScope) {
    // Out-of-mandate remediation is an expansion, not silent work. Name the exact decision: an
    // unnamed finding class needs a wider capability, whereas an out-of-scope artifact path needs a
    // wider workspace boundary. A finding-class expansion takes precedence when both are exceeded,
    // because the capability is the broader grant.
    return { kind: "expansion", decision_type: !findingsInScope ? "capability_change" : "workspace_change" };
  }
  return { kind: "in_scope", scope: { finding_classes: requested.finding_classes, artifact_scope: requested.artifact_scope } };
}

export interface RouteIdentity {
  outer_harness: string;
  provider: string;
}

// The verifier that produced a finding may not repair it: the remediation route
// must differ from the verifier route in BOTH provider and outer harness.
export function assertRemediationIndependence(routes: { verifier_route: RouteIdentity; remediation_route: RouteIdentity }): void {
  const { verifier_route, remediation_route } = routes;
  if (remediation_route.provider === verifier_route.provider && remediation_route.outer_harness === verifier_route.outer_harness) {
    throw new Error("Remediation is not independent: the verifier may not repair its own finding on the same route.");
  }
  if (remediation_route.provider === verifier_route.provider) {
    throw new Error("Remediation is not independent: it shares a provider with the verifier.");
  }
  if (remediation_route.outer_harness === verifier_route.outer_harness) {
    throw new Error("Remediation is not independent: it shares an outer harness with the verifier.");
  }
}
