// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as semver from "semver";
import {
  DEFAULT_TARGET_VERSIONS,
  TerraformCliProbe,
  TerraformTargetVersions,
} from "@cdktn/commons";

export interface InstalledBinaryCheck {
  /** The binary definitely does not match the declared targets. */
  readonly errors: string[];
  /** The binary could not be verified; it may still match. */
  readonly warnings: string[];
}

/**
 * Verifies that the installed Terraform-compatible binary satisfies the
 * project's declared `targetVersions` (cdktf.json). Only invoked when the
 * project opts in via `validateInstalledBinary: true`, by commands that are
 * about to execute the binary anyway.
 *
 * Declared targets state the project's supported range; this check is the
 * explicit step that proves the local binary actually falls inside it.
 */
export function checkInstalledBinaryAgainstTargets(
  cli: TerraformCliProbe,
  declaredTargets: TerraformTargetVersions | undefined,
  binaryName: string,
): InstalledBinaryCheck {
  const targets = declaredTargets ?? DEFAULT_TARGET_VERSIONS;

  if (cli.name === "missing") {
    return {
      errors: [
        `The binary "${binaryName}" could not be found, so it could not be verified against the declared targetVersions`,
      ],
      warnings: [],
    };
  }

  if (cli.name === "unknown" || !cli.version) {
    return {
      errors: [],
      warnings: [
        `Could not determine whether ${binaryName} is Terraform or OpenTofu from its version output, so it was not verified against the declared targetVersions`,
      ],
    };
  }

  const declaredRange = targets[cli.name];
  if (!declaredRange) {
    return {
      errors: [
        `The installed binary "${binaryName}" is ${cli.name} ${cli.version}, but the project's targetVersions does not declare ${cli.name} (declared: ${JSON.stringify(
          targets,
        )})`,
      ],
      warnings: [],
    };
  }

  if (!semver.satisfies(cli.version, declaredRange)) {
    return {
      errors: [
        `The installed binary "${binaryName}" is ${cli.name} ${cli.version}, which is outside the project's declared targetVersions.${cli.name} range "${declaredRange}"`,
      ],
      warnings: [],
    };
  }

  return { errors: [], warnings: [] };
}
