declare module 'class-transformer' {
  export function plainToInstance<T, V>(cls: new (...args: any[]) => T, plain: V[], options?: any): T[];
  export function plainToInstance<T, V>(cls: new (...args: any[]) => T, plain: V, options?: any): T;
  export function Exclude(options?: any): PropertyDecorator & ClassDecorator;
  export function Expose(options?: any): PropertyDecorator & ClassDecorator;
  export function Type(typeFunction?: any, options?: any): PropertyDecorator;
  export function instanceToPlain<T>(object: T, options?: any): Record<string, any>;
  export function classToPlain<T>(object: T, options?: any): Record<string, any>;
  export function Transform(transformFn: any, options?: any): PropertyDecorator;
}
