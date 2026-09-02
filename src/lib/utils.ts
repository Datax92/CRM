export function cn(...inputs: (string | undefined | null | false | 0 | Record<string, boolean>)[]) {
  return inputs
    .filter(Boolean)
    .map((x) => {
      if (typeof x === "object" && x !== null) {
        return Object.entries(x)
          .filter(([, v]) => Boolean(v))
          .map(([k]) => k)
          .join(" ");
      }
      return x;
    })
    .join(" ");
}
