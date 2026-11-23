import { paletteA } from "./sources/a";
import { paletteB } from "./sources/b";
import { paletteC } from "./sources/c";
import { paletteD } from "./sources/d";
import { paletteE } from "./sources/e";
import { paletteF } from "./sources/f";
import type { PaletteSource } from "./types";

export type { PaletteCommand, PaletteContext, PaletteHit, PaletteSource } from "./types";
export { commandSource } from "./types";

/** Every stream's palette sources, sorted by `order` (stream A). Streams edit ONLY `./sources/<stream>.ts`. */
export const PALETTE_SOURCES: readonly PaletteSource[] = [...paletteA, ...paletteB, ...paletteC, ...paletteD, ...paletteE, ...paletteF].sort((a, b) => a.order - b.order);
