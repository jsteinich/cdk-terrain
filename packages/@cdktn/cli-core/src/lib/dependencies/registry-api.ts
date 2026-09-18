// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import { fetch, ProxyAgent } from "undici";
import { ProviderConstraint } from "./dependency-manager";
import * as semver from "semver";
import { Errors, Registry, TERRAFORM_REGISTRY } from "@cdktn/commons";

type VersionsReturnType = {
  id: string; // e.g. hashicorp/aws
  versions: {
    version: string; // e.g. "0.12.0"
    protocols: unknown;
    platforms: unknown;
  }[];
};

async function fetchVersions(
  constraint: ProviderConstraint,
  registry: Registry,
): Promise<VersionsReturnType["versions"] | null> {
  const proxy = process.env.http_proxy || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const url = `https://${registry.hostname}/v1/providers/${constraint.namespace}/${constraint.name}/versions`;

  const result = await fetch(url, {
    dispatcher,
    headers: { "User-Agent": "OpenConstructs/cdktn-cli" },
  });
  if (!result.ok) {
    if (result.status !== 404) {
      throw Errors.External(`Failed to fetch ${url}. Status: ${result.status}`);
    }

    return null;
  }

  const json = (await result.json()) as VersionsReturnType;
  return json.versions;
}

/**
 * returns the latest available version for the provider in the constraint
 * the version of the constraint is ignored
 * returns null, if the provider does not exist
 *
 * Both registries expose the same /v1/providers/<ns>/<name>/versions shape,
 * and their version lists differ, so the project's target decides which to ask.
 */
export async function getLatestVersion(
  constraint: ProviderConstraint,
  registry: Registry = TERRAFORM_REGISTRY,
): Promise<string | null> {
  const versions = await fetchVersions(constraint, registry);
  if (!versions) {
    return null;
  }

  const latestVersion = versions
    .map((v) => v.version)
    .reduce((acc, curr) => {
      if (semver.gte(acc, curr)) {
        return acc;
      }
      return curr;
    });

  return latestVersion;
}
