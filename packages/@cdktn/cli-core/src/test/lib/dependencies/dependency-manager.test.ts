// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  Language,
  OPENTOFU_REGISTRY,
  TerraformProviderConstraint,
} from "@cdktn/commons";
import {
  ProviderConstraint,
  DependencyManager,
} from "../../../lib/dependencies/dependency-manager";

describe("dependency manager", () => {
  describe("ProviderConstraint", () => {
    it.each(["aws", "hashicorp/aws", "registry.terraform.io/hashicorp/aws"])(
      "should parse a simple constraint from '%s'",
      (configEntry) => {
        const constraint = ProviderConstraint.fromConfigEntry(configEntry);
        expect(constraint.source).toEqual(
          "registry.terraform.io/hashicorp/aws",
        );
        expect(constraint.hostname).toEqual("registry.terraform.io");
        expect(constraint.isFromPublicRegistry()).toBe(true);
        expect(constraint.namespace).toEqual("hashicorp");
        expect(constraint.name).toEqual("aws");
        expect(constraint.simplifiedName).toEqual("aws");
        expect(constraint.version).toEqual(undefined);
        // should match any version as none was passed
        expect(constraint.matchesVersion("4.12.1")).toBe(true);
        expect(constraint.matchesVersion("3")).toBe(true);
        expect(constraint.matchesVersion("1")).toBe(true);
      },
    );

    it.each([
      "aws@4.1.1",
      "hashicorp/aws@>4",
      "registry.terraform.io/hashicorp/aws@~>4.1",
    ])(
      "should parse a simple constraint with a version from '%s'",
      (configEntry) => {
        const constraint = ProviderConstraint.fromConfigEntry(configEntry);
        expect(constraint.source).toEqual(
          "registry.terraform.io/hashicorp/aws",
        );
        expect(constraint.hostname).toEqual("registry.terraform.io");
        expect(constraint.isFromPublicRegistry()).toBe(true);
        expect(constraint.namespace).toEqual("hashicorp");
        expect(constraint.name).toEqual("aws");
        expect(constraint.version).toBeDefined();
        expect(constraint.matchesVersion("4.1.1")).toBe(true);
      },
    );

    it("should parse a constraint from a non-default namespace", () => {
      const constraint =
        ProviderConstraint.fromConfigEntry("kreuzwerker/docker");
      expect(constraint.hostname).toEqual("registry.terraform.io");
      expect(constraint.isFromPublicRegistry()).toBe(true);
      expect(constraint.namespace).toEqual("kreuzwerker");
      expect(constraint.name).toEqual("docker");
      expect(constraint.simplifiedName).toEqual("kreuzwerker/docker");
    });

    it("should parse a constraint from a custom registry", () => {
      const constraint = ProviderConstraint.fromConfigEntry(
        "registry.example.com/acme/customprovider",
      );
      expect(constraint.hostname).toEqual("registry.example.com");
      expect(constraint.isFromPublicRegistry()).toBe(false);
      expect(constraint.namespace).toEqual("acme");
      expect(constraint.name).toEqual("customprovider");
      expect(constraint.simplifiedName).toEqual(
        "registry.example.com/acme/customprovider",
      );
    });

    it("should return no extra space in toString() result before version", () => {
      const constraint = new ProviderConstraint("random", "*");
      expect(constraint.toString()).toEqual(
        "registry.terraform.io/hashicorp/random@*",
      );
    });
  });

  // `provider upgrade` generates bindings from the returned entry, and the
  // binding's terraformProviderSource is that constraint's source.
  describe("upgradeProvider of a local provider", () => {
    let projectDir: string;
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-mgr-upgrade-"));
      process.chdir(projectDir);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      process.chdir(originalCwd);
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it.each([
      ["a string entry", "registry.opentofu.org/hashicorp/random@=3.6.0"],
      [
        "an object entry",
        {
          name: "random",
          source: "registry.opentofu.org/hashicorp/random",
          version: "=3.6.0",
        },
      ],
    ])("keeps the host of %s on a shorthand upgrade", async (_name, entry) => {
      fs.writeFileSync(
        path.join(projectDir, "cdktf.json"),
        JSON.stringify({
          language: "typescript",
          app: "npx tsx main.ts",
          terraformProviders: [entry],
          targetVersions: { opentofu: ">=1.6.0" },
        }),
      );
      const mgr = new DependencyManager(
        Language.TYPESCRIPT,
        "0.0.0",
        projectDir,
      );
      jest
        .spyOn(mgr, "getCurrentlyInstalledVersion")
        .mockResolvedValue(undefined);

      const upgraded = await mgr.upgradeProvider(
        new ProviderConstraint("random", "=3.6.1", OPENTOFU_REGISTRY),
      );

      if (!upgraded.addedLocalProvider) throw new Error("expected local");
      const generated = new TerraformProviderConstraint(upgraded.updatedEntry);
      expect(generated.source).toBe("registry.opentofu.org/hashicorp/random");
      expect(generated.version).toBe("=3.6.1");
    });
  });

  describe("addLocalProvider", () => {
    it("throws if the provider is not found", async () => {
      const mgr = new DependencyManager(
        Language.TYPESCRIPT,
        "0.11.2",
        __dirname,
      );

      await expect(() =>
        mgr.addLocalProvider(new ProviderConstraint("aaawwwwwssss", undefined)),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Usage Error: Could not find a version for the provider 'registry.terraform.io/hashicorp/aaawwwwwssss' in the public registry. This could be due to a typo, please take a look at https://registry.terraform.io/browse/providers to find all supported providers."`,
      );
    });
  });
});
