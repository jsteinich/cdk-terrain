// Copyright (c) HashiCorp, Inc
// SPDX-License-Identifier: MPL-2.0
import type { Struct } from "./struct";

// Experiment: struct lists/maps use cdktn.ComplexObjectList/Map<T, TRef> instead of per-struct classes.
export const genericsEnabled = () => process.env.CDKTN_GENERICS === "1";

export function genericCollectionKind(
  struct: Struct,
): "list" | "map" | undefined {
  if (!genericsEnabled()) return undefined;
  if (
    !struct.isSingleItem &&
    (struct.nestingMode === "list" || struct.nestingMode === "set")
  )
    return "list";
  if (struct.nestingMode === "map") return "map";
  return undefined;
}
