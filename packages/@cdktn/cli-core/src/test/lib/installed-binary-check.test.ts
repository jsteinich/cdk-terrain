// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  TerraformCliProbe,
  logger,
  seedTerraformCliProbeForTests,
} from "@cdktn/commons";
import { CdktfStack } from "../../lib/cdktf-stack";
import { checkInstalledBinaryAgainstTargets } from "../../lib/installed-binary-check";

describe("checkInstalledBinaryAgainstTargets", () => {
  const terraform: TerraformCliProbe = { name: "terraform", version: "1.6.5" };
  const openTofu: TerraformCliProbe = { name: "opentofu", version: "1.9.3" };
  const passes = { errors: [], warnings: [] };

  it("passes when the installed binary satisfies the declared range", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        terraform,
        { terraform: ">=1.5.7" },
        "terraform",
      ),
    ).toEqual(passes);
  });

  it("evaluates the range of the detected product", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        openTofu,
        { terraform: ">=1.10.0", opentofu: ">=1.6.0" },
        "tofu",
      ),
    ).toEqual(passes);
  });

  it("fails when the installed binary is outside the declared range", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        terraform,
        { terraform: ">=1.10.0" },
        "terraform",
      ),
    ).toEqual({
      errors: [
        `The installed binary "terraform" is terraform 1.6.5, which is outside the project's declared targetVersions.terraform range ">=1.10.0"`,
      ],
      warnings: [],
    });
  });

  it("fails when the project does not declare the installed product", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        openTofu,
        { terraform: ">=1.5.7" },
        "tofu",
      ),
    ).toEqual({
      errors: [
        `The installed binary "tofu" is opentofu 1.9.3, but the project's targetVersions does not declare opentofu (declared: {"terraform":">=1.5.7"})`,
      ],
      warnings: [],
    });
  });

  it("falls back to the dual product baseline when nothing is declared", () => {
    expect(
      checkInstalledBinaryAgainstTargets(terraform, undefined, "terraform"),
    ).toEqual(passes);
    expect(
      checkInstalledBinaryAgainstTargets(openTofu, undefined, "tofu"),
    ).toEqual(passes);
  });

  it("fails when the binary cannot be found", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        { name: "missing" },
        { terraform: ">=1.5.7" },
        "terraform",
      ),
    ).toEqual({
      errors: [
        `The binary "terraform" could not be found, so it could not be verified against the declared targetVersions`,
      ],
      warnings: [],
    });
  });

  // The probe reports `unknown` for unrecognised output, a failed run or a
  // timeout; none of those shows a mismatch, so they warn instead of failing.
  it("warns rather than fails when the binary cannot be identified", () => {
    expect(
      checkInstalledBinaryAgainstTargets(
        { name: "unknown" },
        { terraform: ">=1.5.7" },
        "terraform",
      ),
    ).toEqual({
      errors: [],
      warnings: [
        `Could not determine whether terraform is Terraform or OpenTofu from its version output, so it was not verified against the declared targetVersions`,
      ],
    });
  });
});

// The opt-in check runs on every stack's init; it reads the cached probe so it
// adds no `version` spawn or output per stack.
describe("CdktfStack with validateInstalledBinary", () => {
  let projectDir: string;
  let originalCwd: string;
  let terraform: { init: jest.Mock; version: jest.Mock };

  const stackNamed = (name: string) =>
    new CdktfStack({
      stack: {
        name,
        dependencies: [],
        annotations: [],
        content: JSON.stringify({
          "//": {
            metadata: { version: "0.0.0", stackName: name, backend: "local" },
            outputs: {},
          },
        }),
        constructPath: ".",
        synthesizedStackPath: ".",
        workingDirectory: projectDir,
        stackMetadataPath: ".",
      },
      onUpdate: () => {},
      abortSignal: new AbortController().signal,
    });

  beforeEach(() => {
    originalCwd = process.cwd();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "binary-check-"));
    fs.writeFileSync(
      path.join(projectDir, "cdktf.json"),
      JSON.stringify({
        language: "typescript",
        app: "npx tsx main.ts",
        validateInstalledBinary: true,
        targetVersions: { terraform: ">=1.10.0" },
      }),
    );
    process.chdir(projectDir);
    terraform = { init: jest.fn(), version: jest.fn() };
    jest
      .spyOn(CdktfStack.prototype as any, "terraformClient")
      .mockResolvedValue(terraform);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    seedTerraformCliProbeForTests();
    process.chdir(originalCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("fails on a mismatch from the cached probe, without a per-stack version call", async () => {
    seedTerraformCliProbeForTests(Promise.resolve("Terraform v1.6.5\n"));

    await expect(stackNamed("a").initalizeTerraform()).rejects.toThrow(
      /outside the project's declared targetVersions\.terraform range/,
    );
    expect(terraform.version).not.toHaveBeenCalled();
    expect(terraform.init).not.toHaveBeenCalled();
  });

  it("warns once per process when the binary cannot be identified", async () => {
    seedTerraformCliProbeForTests(Promise.resolve("not a version banner"));
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

    await stackNamed("a").initalizeTerraform();
    await stackNamed("b").initalizeTerraform();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(terraform.init).toHaveBeenCalledTimes(2);
    expect(terraform.version).not.toHaveBeenCalled();
  });
});
