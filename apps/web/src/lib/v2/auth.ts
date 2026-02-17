import { NextResponse } from "next/server";
import {
  type Permission,
  permissionSchema,
  projectMemberRoleSchema,
  type ProjectMemberRole,
  type ApiKeyScope,
} from "@flowstate/types";

import {
  authenticateApiKey,
  getProject,
  getProjectMembership,
  markApiKeyUsed,
} from "@/lib/data-store-v2";

type AuthMode = "optional" | "strict";

type AuthActor = {
  type: "api_key" | "local";
  email: string | null;
  role: ProjectMemberRole;
  scopes: ApiKeyScope[];
  projectId: string | null;
  organizationId: string | null;
  apiKeyId: string | null;
};

const ROLE_PERMISSIONS: Record<ProjectMemberRole, Permission[]> = {
  owner: [
    "manage_project",
    "manage_members",
    "manage_keys",
    "create_flow",
    "deploy_flow",
    "run_flow",
    "review_queue",
    "read_project",
  ],
  admin: ["manage_members", "manage_keys", "create_flow", "deploy_flow", "run_flow", "review_queue", "read_project"],
  builder: ["create_flow", "deploy_flow", "run_flow", "read_project"],
  reviewer: ["review_queue", "read_project"],
  viewer: ["read_project"],
};

const PERMISSION_TO_SCOPE: Record<Permission, ApiKeyScope> = {
  manage_project: "manage_projects",
  manage_members: "manage_members",
  manage_keys: "manage_keys",
  create_flow: "create_flow",
  deploy_flow: "deploy_flow",
  run_flow: "run_flow",
  review_queue: "review_queue",
  read_project: "read_project",
};

function authMode(): AuthMode {
  const raw = (process.env.FLOWSTATE_AUTH_MODE || "optional").toLowerCase();
  return raw === "strict" ? "strict" : "optional";
}

function parseBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");

  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");

  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
}

function hasRolePermission(role: ProjectMemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

function hasScope(scopes: ApiKeyScope[], permission: Permission): boolean {
  return scopes.includes(PERMISSION_TO_SCOPE[permission]);
}

async function resolveLocalRole(input: {
  preferredRole: ProjectMemberRole;
  email: string;
  projectId?: string;
}): Promise<ProjectMemberRole> {
  if (!input.projectId) {
    return input.preferredRole;
  }

  const project = await getProject(input.projectId);

  if (!project) {
    return input.preferredRole;
  }

  const membership = await getProjectMembership(project.id, input.email);

  if (!membership) {
    return input.preferredRole;
  }

  return membership.role;
}

export async function parseAuthActor(request: Request, projectId?: string): Promise<AuthActor | null> {
  const token = parseBearerToken(request);

  if (token) {
    const apiKey = await authenticateApiKey(token);

    if (!apiKey) {
      return null;
    }

    await markApiKeyUsed(apiKey.id, "api-key");

    return {
      type: "api_key",
      email: null,
      role: apiKey.role,
      scopes: apiKey.scopes,
      projectId: apiKey.project_id,
      organizationId: apiKey.organization_id,
      apiKeyId: apiKey.id,
    };
  }

  if (authMode() === "strict") {
    return null;
  }

  const email = (request.headers.get("x-flowstate-actor-email") || "local@flowstate.dev").trim().toLowerCase();
  const rawRole = request.headers.get("x-flowstate-actor-role") || "owner";
  const parsedRole = projectMemberRoleSchema.safeParse(rawRole);
  const preferredRole = parsedRole.success ? parsedRole.data : "owner";
  const role = await resolveLocalRole({ preferredRole, email, projectId });

  return {
    type: "local",
    email,
    role,
    scopes: [
      "manage_projects",
      "manage_members",
      "manage_keys",
      "create_flow",
      "deploy_flow",
      "run_flow",
      "review_queue",
      "read_project",
    ],
    projectId: projectId ?? null,
    organizationId: null,
    apiKeyId: null,
  };
}

export async function requirePermission(input: {
  request: Request;
  permission: Permission;
  projectId?: string;
}) {
  permissionSchema.parse(input.permission);

  const actor = await parseAuthActor(input.request, input.projectId);

  if (!actor) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "Authentication required",
          hint: "Provide bearer API key in strict mode.",
        },
        { status: 401 },
      ),
    };
  }

  if (actor.type === "api_key" && input.projectId && actor.projectId && actor.projectId !== input.projectId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "API key is scoped to another project" }, { status: 403 }),
    };
  }

  if (!hasRolePermission(actor.role, input.permission) || !hasScope(actor.scopes, input.permission)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "Permission denied",
          required_permission: input.permission,
          actor_role: actor.role,
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    actor,
  };
}
