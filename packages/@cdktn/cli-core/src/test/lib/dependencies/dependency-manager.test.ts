// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  Dispatcher,
} from "undici";
import { Language, OPENTOFU_REGISTRY } from "@cdktn/commons";
import {
  ProviderConstraint,
  DependencyManager,
} from "../../../lib/dependencies/dependency-manager";
import { resetFetchCache } from "../../../lib/dependencies/prebuilt-providers";

describe("dependency manager", () => {
  describe("ProviderConstraint", () => {
    describe("requiredProvidersSource", () => {
      it("drops a host that normalization added", () => {
        expect(
          new ProviderConstraint("random", "=3.6.1", OPENTOFU_REGISTRY)
            .requiredProvidersSource,
        ).toBe("hashicorp/random");
        expect(
          new ProviderConstraint(
            "hashicorp/random",
            "=3.6.1",
            OPENTOFU_REGISTRY,
          ).requiredProvidersSource,
        ).toBe("hashicorp/random");
      });

      it("keeps a public host the user wrote", () => {
        expect(
          new ProviderConstraint(
            "registry.terraform.io/hashicorp/random",
            "=3.6.1",
            OPENTOFU_REGISTRY,
          ).requiredProvidersSource,
        ).toBe("registry.terraform.io/hashicorp/random");
      });

      it("keeps a private host", () => {
        expect(
          new ProviderConstraint(
            "registry.example.com/acme/thing",
            "1.0.0",
            OPENTOFU_REGISTRY,
          ).requiredProvidersSource,
        ).toBe("registry.example.com/acme/thing");
      });
    });

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

  describe("convertPackageName", () => {
    it.each([
      [
        "@cdktn/provider-google-beta",
        "github.com/cdktn-io/cdktn-provider-googlebeta",
        "github.com/cdktn-io/cdktn-provider-googlebeta-go/googlebeta",
      ],
      [
        "@cdktn/provider-google-beta",
        "",
        "github.com/cdktn-io/cdktn-provider-googlebeta-go/googlebeta",
      ],
      [
        "@cdktf/provider-google-beta",
        "github.com/cdktf/cdktf-provider-googlebeta",
        "github.com/cdktf/cdktf-provider-googlebeta-go/googlebeta",
      ],
    ])(
      "drops dashes from the Go package for %s (repository '%s')",
      (npmName, repository, goName) => {
        const mgr = new DependencyManager(Language.GO, "0.25.0", __dirname);
        expect(
          (mgr as any).convertPackageName(
            npmName,
            repository,
            npmName.startsWith("@cdktn"),
          ),
        ).toBe(goName);
      },
    );
  });

  describe("getCurrentlyInstalledVersion", () => {
    let originalDispatcher: Dispatcher;
    let mockAgent: MockAgent;

    beforeEach(() => {
      originalDispatcher = getGlobalDispatcher();
      mockAgent = new MockAgent();
      mockAgent.disableNetConnect();
      setGlobalDispatcher(mockAgent);
    });

    afterEach(() => {
      resetFetchCache();
      setGlobalDispatcher(originalDispatcher);
    });

    it("finds a provider published only under @cdktn", async () => {
      mockAgent
        .get("https://raw.githubusercontent.com")
        .intercept({
          path: /.*cdktn-repository-manager.*provider\.json/,
          method: "GET",
        })
        .reply(200, { awscc: "hashicorp/awscc@~> 1.0" });
      mockAgent
        .get("https://registry.npmjs.org")
        .intercept({ path: "/@cdktf/provider-awscc", method: "GET" })
        .reply(404, "Not found");
      mockAgent
        .get("https://registry.npmjs.org")
        .intercept({ path: "/@cdktn/provider-awscc", method: "GET" })
        .reply(200, {
          repository: {
            type: "git",
            url: "git+https://github.com/cdktn-io/cdktn-provider-awscc.git",
          },
        });

      const mgr = new DependencyManager(
        Language.TYPESCRIPT,
        "0.12.2",
        __dirname,
      );
      jest
        .spyOn((mgr as any).packageManager, "listProviderPackages")
        .mockResolvedValue([
          { name: "@cdktn/provider-awscc", version: "1.2.0" },
        ]);

      await expect(
        mgr.getCurrentlyInstalledVersion(
          ProviderConstraint.fromConfigEntry("hashicorp/awscc"),
        ),
      ).resolves.toBe("1.2.0");
      expect(mockAgent.pendingInterceptors()).toHaveLength(0);
    });
  });
});
