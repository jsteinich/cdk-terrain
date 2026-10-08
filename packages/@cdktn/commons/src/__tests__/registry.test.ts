// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import {
  OPENTOFU_REGISTRY,
  TERRAFORM_REGISTRY,
  registryForTargetVersions,
} from "../registry";

describe("moduleDocsUrl", () => {
  const source = "terraform-aws-modules/vpc/aws";

  describe("Terraform", () => {
    it("links to a pinned module version", () => {
      expect(TERRAFORM_REGISTRY.moduleDocsUrl(source, "3.12.0")).toBe(
        "https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/3.12.0",
      );
    });

    it("links to latest without a version", () => {
      expect(TERRAFORM_REGISTRY.moduleDocsUrl(source)).toBe(
        "https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest",
      );
    });

    it("links to a submodule", () => {
      expect(
        TERRAFORM_REGISTRY.moduleDocsUrl(source, "3.12.0", "vpc-endpoints"),
      ).toBe(
        "https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/3.12.0/submodules/vpc-endpoints",
      );
    });
  });

  describe("OpenTofu", () => {
    // Verified against search.opentofu.org: the v prefix is required, and
    // "submodule" is singular.
    it("v-prefixes a pinned module version", () => {
      expect(OPENTOFU_REGISTRY.moduleDocsUrl(source, "3.12.0")).toBe(
        "https://search.opentofu.org/module/terraform-aws-modules/vpc/aws/v3.12.0",
      );
    });

    it("links to latest without a version, and does not v-prefix it", () => {
      expect(OPENTOFU_REGISTRY.moduleDocsUrl(source)).toBe(
        "https://search.opentofu.org/module/terraform-aws-modules/vpc/aws/latest",
      );
    });

    it("links to a submodule", () => {
      expect(
        OPENTOFU_REGISTRY.moduleDocsUrl(source, "3.12.0", "vpc-endpoints"),
      ).toBe(
        "https://search.opentofu.org/module/terraform-aws-modules/vpc/aws/v3.12.0/submodule/vpc-endpoints",
      );
    });
  });

  it("follows the project's declared targets", () => {
    expect(
      registryForTargetVersions({ opentofu: ">=1.6.0" }).moduleDocsUrl(
        source,
        "3.12.0",
      ),
    ).toContain("search.opentofu.org");

    expect(
      registryForTargetVersions({
        opentofu: ">=1.6.0",
        terraform: ">=1.5.7",
      }).moduleDocsUrl(source, "3.12.0"),
    ).toContain("registry.terraform.io");

    expect(registryForTargetVersions().moduleDocsUrl(source)).toContain(
      "registry.terraform.io",
    );
  });
});
