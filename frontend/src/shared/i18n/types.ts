/**
 * Shapes every translated dictionary is checked against.
 *
 * `Strings<T>` is the same tree as `T` with every leaf widened to `string`: it is what makes
 * `ar.ts` comparable to the `en.ts` beside it — the keys and the nesting must match exactly, while
 * the text itself is free. `TranslationKey<T>` turns that tree into the dot paths a page asks for
 * (`"twoFactor.title"`), so a typo is a compile error rather than a blank label at runtime.
 */
export type Strings<T> = {
  [K in keyof T]: T[K] extends string ? string : Strings<T[K]>;
};

export type TranslationKey<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${TranslationKey<T[K]>}`;
    }[keyof T & string];

/**
 * The paths that name a group of strings rather than one string (`"wallet.page"`, `"shell"`).
 * `useT` takes one of these; a path that points at a single string is not a namespace.
 */
export type TranslationNamespace<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? never
        : K | `${K}.${TranslationNamespace<T[K]>}`;
    }[keyof T & string];

/** The group of strings a namespace path points at, so its keys can be typed. */
export type AtPath<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? AtPath<T[Head], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

/** Values a `{name}` placeholder in a translated string can be filled with. */
export type TranslationParams = Record<string, string | number>;
