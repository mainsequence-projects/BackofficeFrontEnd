// Product V1 reconciles document facts. Portraits and face comparison are V2 scope.
export function documentFieldInV1(path: string): boolean {
  return !path.split(/[/.]/).includes("portrait_reference");
}

export function documentFacts(payload: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => documentFieldInV1(key)),
  );
}
