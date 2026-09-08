// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import * as fs from "fs";
import * as path from "path";
import { TerraformProviderGenerator } from "../../generator/provider-generator";
import {
  assertNoFunctionsGetterCollision,
  buildProviderFunctionsModel,
} from "../../generator/models/provider-function-model";
import { CodeMaker, toSnakeCase } from "codemaker";
import { FunctionSignature } from "@cdktn/commons";
import { createTmpHelper } from "../util";

const tmp = createTmpHelper();

/**
 * Verbatim copy of jsii-pacmak's Python cross-submodule import path
 * calculation (jsii-pacmak@1.128.0
 * `lib/targets/python/type-name.ts#relativeImportPath`), including the
 * `startsWith` test that is missing a `.`-boundary check. Copied rather than
 * approximated so the assertion below fails for exactly the layouts pacmak
 * mis-renders.
 */
function pacmakRelativeImportPath(fromPkg: string, toPkg: string): string {
  if (toPkg.startsWith(fromPkg)) {
    return `.${toPkg.substring(fromPkg.length + 1)}`;
  }
  const fromPkgParent = fromPkg.substring(0, fromPkg.lastIndexOf("."));
  return `.${pacmakRelativeImportPath(fromPkgParent, toPkg)}`;
}

/**
 * Resolves a Python relative import specifier (`.x`, `..x`, ...) written
 * inside the package `fromPkg` to the absolute module it names. One leading
 * dot means "this package", each further dot climbs one level.
 */
function resolveRelativeImport(fromPkg: string, specifier: string): string {
  const dots = /^\.*/.exec(specifier)![0].length;
  const tail = specifier.slice(dots);
  const segments = fromPkg.split(".");
  const base = segments.slice(0, segments.length - (dots - 1));
  return [...base, ...(tail ? [tail] : [])].join(".");
}

/** jsii's submodule name -> Python module name mapping. */
const pythonModuleName = (submoduleName: string) => toSnakeCase(submoduleName);

test("generate provider functions for the time provider (real terraform 1.15.6 schema fragment)", async () => {
  const code = new CodeMaker();
  const workdir = tmp("provider-functions.test");
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures", "provider-functions.test.fixture.json"),
      "utf-8",
    ),
  );
  new TerraformProviderGenerator(code, spec).generateAll();
  await code.save(workdir);

  const providerFunctionsOutput = fs.readFileSync(
    path.join(workdir, "providers/time/functions/index.ts"),
    "utf-8",
  );
  expect(providerFunctionsOutput).toMatchSnapshot("time-provider-functions");

  const providerOutput = fs.readFileSync(
    path.join(workdir, "providers/time/provider/index.ts"),
    "utf-8",
  );
  expect(providerOutput).toMatchSnapshot("time-provider");

  const providerIndex = fs.readFileSync(
    path.join(workdir, "providers/time/index.ts"),
    "utf-8",
  );
  expect(providerIndex).toMatchSnapshot("provider-index");

  const providerLazyIndex = fs.readFileSync(
    path.join(workdir, "providers/time/lazy-index.ts"),
    "utf-8",
  );
  expect(providerLazyIndex).toMatchSnapshot("provider-lazy-index");
});

// Regression test for the Python bindings of a provider that declares
// provider-defined functions.
//
// The provider class lives in the `provider` jsii submodule and imports the
// functions wrapper class from a sibling submodule. jsii-pacmak renders that
// cross-submodule reference in Python as a *relative* import, computed by
// `relativeImportPath` - which decides "is the target a child of me?" with a
// bare `toPkg.startsWith(fromPkg)`, no `.`-boundary check. A sibling
// submodule whose Python name merely string-prefixes the importing one is
// therefore mistaken for a child, and pacmak emits an import of a module
// that was never written to disk. That is what a `provider-functions` folder
// did: submodule `<provider>.provider_functions` string-prefixes
// `<provider>.provider`, so `<provider>/provider/__init__.py` got
// `from .functions import ...` and importing the provider raised
// ModuleNotFoundError (Go/Java/C# are unaffected - they use fully qualified
// names and never compute a relative path).
//
// Rather than assert the folder name, this reproduces pacmak's own
// calculation over the emitted layout and checks the import it would write
// actually resolves to the emitted functions submodule.
test("the emitted layout makes jsii-pacmak's Python relative import from the provider submodule resolve to the functions submodule", async () => {
  const code = new CodeMaker();
  const workdir = tmp("provider-functions-python-layout.test");
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures", "provider-functions.test.fixture.json"),
      "utf-8",
    ),
  );
  new TerraformProviderGenerator(code, spec).generateAll();
  await code.save(workdir);

  // The folder the provider class imports the functions wrapper from, read
  // back out of the generated source instead of hard-coded.
  const providerOutput = fs.readFileSync(
    path.join(workdir, "providers/time/provider/index.ts"),
    "utf-8",
  );
  const importMatch = /from '\.\.\/([^/]+)\/index'/.exec(providerOutput);
  expect(importMatch).not.toBeNull();
  const functionsFolder = importMatch![1];

  // ...and it has to be a submodule the root index actually exports, or
  // there would be no Python package for it at all.
  const providerIndex = fs.readFileSync(
    path.join(workdir, "providers/time/index.ts"),
    "utf-8",
  );
  const submodules = new Map(
    [
      ...providerIndex.matchAll(
        /export \* as (\w+) from '\.\/([^/]+)\/index'/g,
      ),
    ].map((m) => [m[2], m[1]]),
  );
  expect(submodules.has("provider")).toBe(true);
  expect(submodules.has(functionsFolder)).toBe(true);

  // Python module names of the two submodules, under the provider's own
  // Python root package (`imports.<provider>` in a real project).
  const root = "time";
  const providerPkg = `${root}.${pythonModuleName(submodules.get("provider")!)}`;
  const functionsPkg = `${root}.${pythonModuleName(
    submodules.get(functionsFolder)!,
  )}`;

  const specifier = pacmakRelativeImportPath(providerPkg, functionsPkg);
  expect(resolveRelativeImport(providerPkg, specifier)).toBe(functionsPkg);
});

describe("generate provider functions covering variadic parameters, primitive/list returns, and a 'default' parameter name", () => {
  let providerFunctionsOutput: string;
  let providerIndex: string;
  let providerLazyIndex: string;

  beforeAll(async () => {
    const code = new CodeMaker();
    const workdir = tmp("provider-functions-synthetic.test");
    const spec = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "fixtures",
          "provider-functions-synthetic.test.fixture.json",
        ),
        "utf-8",
      ),
    );
    new TerraformProviderGenerator(code, spec).generateAll();
    await code.save(workdir);

    providerFunctionsOutput = fs.readFileSync(
      path.join(workdir, "providers/example/functions/index.ts"),
      "utf-8",
    );
    providerIndex = fs.readFileSync(
      path.join(workdir, "providers/example/index.ts"),
      "utf-8",
    );
    providerLazyIndex = fs.readFileSync(
      path.join(workdir, "providers/example/lazy-index.ts"),
      "utf-8",
    );
  });

  test("matches the snapshot", () => {
    expect(providerFunctionsOutput).toMatchSnapshot(
      "example-provider-functions",
    );
    expect(providerIndex).toMatchSnapshot("provider-index");
    expect(providerLazyIndex).toMatchSnapshot("provider-lazy-index");
  });

  test("nested collection docstrings use the compact recursive Array/Set notation", () => {
    // list(set(string)): notation carries the structure; a plain Terraform
    // list needs no prose note.
    expect(providerFunctionsOutput).toContain(
      "@param {Array<Set<string>>} nameGroups",
    );
    expect(providerFunctionsOutput).toContain("@returns {Array<Set<string>>}");
    // set(list(string)): Set<...> notation plus the set-semantics prose note
    // (the jsii type is still an array - the note keeps a reader from
    // literally passing a JS Set).
    expect(providerFunctionsOutput).toContain(
      "@param {Set<Array<string>>} nameLists - Terraform set; ordering is not guaranteed and duplicate values are removed.",
    );
    expect(providerFunctionsOutput).toContain(
      "@returns {Set<Array<string>>} Terraform set; ordering is not guaranteed and duplicate values are removed.",
    );
  });

  // This package has no TypeScript-compiling harness
  // for generated output (no fixture/test anywhere generates a snippet and
  // feeds it through `tsc`/`ts.transpileModule`, and `cdktn` itself isn't a
  // dependency of this package to typecheck against), so these are
  // structural assertions on the emitted declaration text rather than an
  // actual compile - see also the runtime-level proof in
  // packages/cdktn/test/provider-functions.test.ts, which exercises the
  // same union/token mechanics these signatures rely on.
  describe("composition: a function's return type is directly assignable to another function's parameter of the 'same' Terraform type", () => {
    test("flagsForSeed()'s set(bool) return type (cdktn.IResolvable) is one of the exact union members flagSet()'s set(bool) parameter declares", () => {
      expect(providerFunctionsOutput).toContain(
        "public flagsForSeed(seed: string): cdktn.IResolvable {",
      );
      expect(providerFunctionsOutput).toContain(
        "public flagSet(flags: Array<boolean | cdktn.IResolvable> | cdktn.IResolvable): cdktn.IResolvable {",
      );
    });

    test("defaultTags()'s map(string) return type is textually identical to tagMap()'s map(string) parameter type", () => {
      expect(providerFunctionsOutput).toContain(
        "public defaultTags(prefix: string): { [key: string]: string } {",
      );
      expect(providerFunctionsOutput).toContain(
        "public tagMap(tags: { [key: string]: string }): string {",
      );
    });
  });

  test("a list(bool) parameter (not just set(bool)) also accepts a whole-collection token", () => {
    expect(providerFunctionsOutput).toContain(
      "public flagsOrdered(flags: Array<boolean | cdktn.IResolvable> | cdktn.IResolvable): cdktn.IResolvable {",
    );
  });

  test("a list(object) parameter widens to any[] | cdktn.IResolvable (whole-collection token accepted)", () => {
    expect(providerFunctionsOutput).toContain(
      "public describeConfigs(configs: any[] | cdktn.IResolvable): string {",
    );
  });
});

test("buildProviderFunctionsModel throws when two function names collapse to the same generated method name", () => {
  expect(() =>
    buildProviderFunctionsModel("example", {
      foo_bar: { return_type: "string", parameters: [] },
      foo__bar: { return_type: "string", parameters: [] },
    }),
  ).toThrow(/foo_bar/);
  expect(() =>
    buildProviderFunctionsModel("example", {
      foo_bar: { return_type: "string", parameters: [] },
      foo__bar: { return_type: "string", parameters: [] },
    }),
  ).toThrow(/foo__bar/);
});

test("buildProviderFunctionsModel throws when two parameter names collapse within one function", () => {
  expect(() =>
    buildProviderFunctionsModel("example", {
      my_function: {
        return_type: "string",
        parameters: [
          { name: "some_value", type: "string" },
          { name: "some__value", type: "string" },
        ],
      },
    }),
  ).toThrow(/some_value/);
  expect(() =>
    buildProviderFunctionsModel("example", {
      my_function: {
        return_type: "string",
        parameters: [
          { name: "some_value", type: "string" },
          { name: "some__value", type: "string" },
        ],
      },
    }),
  ).toThrow(/some__value/);
});

// Both of these assert the model-level throw happens before any file is
// generated: buildProviderFunctionsModel is called directly, with no
// CodeMaker/generator involved, so there is no emission step to reach.
test("buildProviderFunctionsModel throws when a function name sanitizes to 'constructor'", () => {
  // The nested signature literal is cast to `FunctionSignature` (rather than
  // relying on contextual typing from the surrounding index signature)
  // because TypeScript special-cases a property literally named
  // "constructor" - contextually typing it against `Function` (from
  // `Object.prototype`) instead of the index signature's `FunctionSignature`,
  // and spuriously flagging `return_type: "string"` as an error. See
  // https://github.com/microsoft/TypeScript/issues/40776.
  const signature: FunctionSignature = {
    return_type: "string",
    parameters: [],
  };
  expect(() =>
    buildProviderFunctionsModel("example", {
      constructor: signature,
    }),
  ).toThrow(/constructor/);
  expect(() =>
    buildProviderFunctionsModel("example", {
      constructor: signature,
    }),
  ).toThrow(/example/);
});

test("buildProviderFunctionsModel throws when a function name sanitizes to 'providerLocalName'", () => {
  expect(() =>
    buildProviderFunctionsModel("example", {
      provider_local_name: { return_type: "string", parameters: [] },
    }),
  ).toThrow(/provider_local_name/);
  expect(() =>
    buildProviderFunctionsModel("example", {
      provider_local_name: { return_type: "string", parameters: [] },
    }),
  ).toThrow(/providerLocalName/);
});

test("assertNoFunctionsGetterCollision throws when the provider's own config schema would generate a 'functions' property", () => {
  expect(() =>
    assertNoFunctionsGetterCollision("example", ["alias", "functions"]),
  ).toThrow(/"functions"/);
});

test("assertNoFunctionsGetterCollision does not throw when there is no colliding attribute", () => {
  expect(() =>
    assertNoFunctionsGetterCollision("example", ["alias"]),
  ).not.toThrow();
});

test("generation throws when a provider's config attribute collides with the generated 'functions' getter", async () => {
  const code = new CodeMaker();
  const spec = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "fixtures",
        "provider-functions-collision.test.fixture.json",
      ),
      "utf-8",
    ),
  );
  expect(() =>
    new TerraformProviderGenerator(code, spec).generateAll(),
  ).toThrow(/"functions"/);
});
