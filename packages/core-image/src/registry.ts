import type { Filter, FilterOptions } from "./types.js";

/**
 * Registry mapping filter names to Filter implementations. Deliberately has
 * no dependency on the DOM/Canvas so it's usable from a Web Worker, from
 * tests, or from a future headless/server context.
 */
export class FilterRegistry {
  private readonly filters = new Map<string, Filter<never>>();

  register<TOptions extends FilterOptions>(name: string, filter: Filter<TOptions>): void {
    if (this.filters.has(name)) {
      throw new Error(`Filter "${name}" is already registered`);
    }
    this.filters.set(name, filter as Filter<never>);
  }

  get<TOptions extends FilterOptions>(name: string): Filter<TOptions> | undefined {
    return this.filters.get(name) as Filter<TOptions> | undefined;
  }

  has(name: string): boolean {
    return this.filters.has(name);
  }

  list(): string[] {
    return Array.from(this.filters.keys()).sort();
  }

  apply<TOptions extends FilterOptions>(
    name: string,
    image: ImageData,
    options: TOptions,
  ): ImageData {
    const filter = this.get<TOptions>(name);
    if (!filter) {
      throw new Error(`No filter registered under name "${name}"`);
    }
    return filter(image, options);
  }
}

export function createFilterRegistry(): FilterRegistry {
  return new FilterRegistry();
}
