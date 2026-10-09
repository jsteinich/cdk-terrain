/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

import {
  TerraformProviderLock,
  lockAddressesFor,
} from "../../lib/terraform-provider-lock";
import { readFile, stat } from "fs/promises";
import * as path from "path";
import { ProviderConstraint } from "../../lib/dependencies/dependency-manager";

jest.mock("fs/promises", () => {
  return {
    readFile: jest.fn().mockResolvedValue("contents"),
    stat: jest.fn().mockResolvedValue({}),
  };
});

function generateProviderLockFileContents(
  providers: {
    name: string;
    version?: string;
    constraints?: string;
  }[],
) {
  return providers
    .map((provider) => {
      return [
        `provider "${provider.name}" {`,
        `  version  = "${provider.version || "1.2.3"}"`,
        ` constraints = "${provider.constraints || "1.2"}"`,
        ` hashes = [`,
        `   "h1:123",`,
        `   "h1:456",`,
        ` ]`,
        `}`,
      ].join("\n");
    })
    .join("\n\n");
}

describe("TerraformProviderLock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads the right file", async () => {
    const lock = new TerraformProviderLock("test");
    await lock.providers();

    expect(readFile).toHaveBeenCalledWith(
      path.join("test", ".terraform.lock.hcl"),
    );
  });

  it("doesn't read the file twice", async () => {
    const lock = new TerraformProviderLock("test");
    await lock.providers();
    await lock.providers();

    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("parses provider file", async () => {
    const lock = new TerraformProviderLock("test");
    (readFile as jest.Mock).mockResolvedValueOnce(
      generateProviderLockFileContents([
        {
          name: "registry.terraform.io/hashicorp/test",
          version: "1.2.3",
          constraints: "4.5.6",
        },
      ]),
    );

    const parsedData = await lock.providers();

    expect(parsedData).not.toBeUndefined();
    expect(parsedData["registry.terraform.io/hashicorp/test"]).toEqual(
      expect.objectContaining({
        name: "test",
        version: "1.2.3",
      }),
    );
    expect(
      parsedData["registry.terraform.io/hashicorp/test"].constraints,
    ).toEqual(
      expect.objectContaining({
        source: "registry.terraform.io/hashicorp/test",
        version: "4.5.6",
      }),
    );
  });

  it("parses provider file with multiple providers", async () => {
    const lock = new TerraformProviderLock("test");
    (readFile as jest.Mock).mockResolvedValueOnce(
      generateProviderLockFileContents([
        {
          name: "registry.terraform.io/hashicorp/test",
          version: "1.2.3",
          constraints: "1.2",
        },
        {
          name: "registry.terraform.io/partner/foo",
          version: "4.5.3",
          constraints: "4.5.6",
        },
      ]),
    );

    const parsedData = await lock.providers();

    expect(parsedData).not.toBeUndefined();
    expect(Object.keys(parsedData)).toEqual(
      expect.arrayContaining([
        "registry.terraform.io/partner/foo",
        "registry.terraform.io/hashicorp/test",
      ]),
    );
    expect(
      parsedData["registry.terraform.io/hashicorp/test"].constraints?.version,
    ).toEqual("1.2");
    expect(parsedData["registry.terraform.io/partner/foo"].version).toEqual(
      "4.5.3",
    );
  });

  it("validates provider constraints", async () => {
    const lock = new TerraformProviderLock("test");
    (readFile as jest.Mock).mockResolvedValueOnce(
      generateProviderLockFileContents([
        {
          name: "registry.terraform.io/hashicorp/test",
          version: "1.2.3",
          constraints: "1.2",
        },
        {
          name: "registry.terraform.io/partner/foo",
          version: "4.5.3",
          constraints: "4.5.6",
        },
      ]),
    );

    const requiredProviderConstraint = new ProviderConstraint(
      "registry.terraform.io/hashicorp/test",
      "1.2",
    );
    const requiredProviderConstraintPartner = new ProviderConstraint(
      "registry.terraform.io/partner/foo",
      "4.2",
    );

    expect(
      await lock.hasMatchingProvider(requiredProviderConstraint),
    ).toBeTruthy();
    expect(
      await lock.hasMatchingProvider(requiredProviderConstraintPartner),
    ).toBeFalsy();
  });

  it("handles gracefully when file is not present", async () => {
    const lock = new TerraformProviderLock("test");
    (readFile as jest.Mock).mockRejectedValueOnce(
      new Error("unable to find file"),
    );

    const requiredProviderConstraint = new ProviderConstraint(
      "registry.terraform.io/hashicorp/test",
      "1.2",
    );

    expect(
      await lock.hasMatchingProvider(requiredProviderConstraint),
    ).toBeFalsy();
  });

  it("handles gracefully when lock file doens't have any providers", async () => {
    const lock = new TerraformProviderLock("test");
    (readFile as jest.Mock).mockResolvedValueOnce("");

    const requiredProviderConstraint = new ProviderConstraint(
      "registry.terraform.io/hashicorp/test",
      "1.2",
    );

    expect(
      await lock.hasMatchingProvider(requiredProviderConstraint),
    ).toBeFalsy();
  });

  it("verifies the existence of a lock file", async () => {
    const lock = new TerraformProviderLock("test");
    (stat as jest.Mock).mockResolvedValueOnce({});

    expect(await lock.hasProviderLockFile()).toBeTruthy();
    expect(stat).toHaveBeenCalledWith(path.join("test", ".terraform.lock.hcl"));

    (stat as jest.Mock).mockClear();
    (stat as jest.Mock).mockRejectedValueOnce(new Error("unable to find file"));

    expect(await lock.hasProviderLockFile()).toBeFalsy();
    expect(stat).toHaveBeenCalledWith(path.join("test", ".terraform.lock.hcl"));
  });
});

describe("lockAddressesFor", () => {
  const lockedUnder = (name: string) =>
    (readFile as jest.Mock).mockResolvedValueOnce(
      generateProviderLockFileContents([
        { name, version: "1.2.3", constraints: "1.2" },
      ]),
    );

  /** Whether any address the CLI could have locked `source` under is in the lock. */
  const isLocked = async (source: string) => {
    const lock = new TerraformProviderLock("test");
    for (const address of lockAddressesFor(source, "1.2")) {
      if (await lock.hasMatchingProvider(address)) return true;
    }
    return false;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps a source that names a host to exactly that host", () => {
    expect(
      lockAddressesFor("registry.terraform.io/hashicorp/test").map(
        (a) => a.source,
      ),
    ).toEqual(["registry.terraform.io/hashicorp/test"]);
  });

  it("offers every public registry for a bare source", () => {
    expect(lockAddressesFor("hashicorp/test").map((a) => a.source)).toEqual([
      "registry.terraform.io/hashicorp/test",
      "registry.opentofu.org/hashicorp/test",
    ]);
  });

  it("finds a bare source that Terraform locked", async () => {
    lockedUnder("registry.terraform.io/hashicorp/test");
    await expect(isLocked("hashicorp/test")).resolves.toBe(true);
  });

  it("finds a bare source that OpenTofu locked", async () => {
    lockedUnder("registry.opentofu.org/hashicorp/test");
    await expect(isLocked("hashicorp/test")).resolves.toBe(true);
  });

  // Matching on provider alone would report this as locked, skip init, and
  // leave the CLI to fail on an address that is not in the lock file.
  it("does not let a different public registry satisfy an explicit host", async () => {
    lockedUnder("registry.opentofu.org/hashicorp/test");
    await expect(
      isLocked("registry.terraform.io/hashicorp/test"),
    ).resolves.toBe(false);
  });

  it("does not let a public registry satisfy a private host", async () => {
    lockedUnder("registry.terraform.io/hashicorp/test");
    await expect(
      isLocked("my.registry.example.com/hashicorp/test"),
    ).resolves.toBe(false);
  });
});
