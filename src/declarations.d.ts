
// TODO remove when @types/yup are up to date

declare module 'yup' {
  interface Schema<T = any> {

  }

  interface MixedSchema<T = any> extends Schema<T> {
    defined(): MixedSchema<T>;
  }
  interface StringSchema<T extends string | null | undefined = string> extends Schema<T> {
    defined(): StringSchema<T>;
  }
}

export {};
