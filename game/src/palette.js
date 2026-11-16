// Breachline palette: the dusk-industrial colour plan in one place — slate yard,
// warm sodium sun, amber Breachers vs teal Wardens. Every material, light and
// HUD tint in the game derives from these hexes; no stray colour appears elsewhere.
export const CANVAS = '#14161a';   // fog, clear colour, darkest tone
export const SURFACE = '#1e2228';  // pads, panels, dark structures
export const HAIRLINE = '#2c323a'; // trim, frames, recessed metal
export const INK = '#e9e6df';      // pale signage, highlights
export const MUTED = '#98a0a8';    // painted lane stripes
export const ACCENT = '#f0a830';   // holo markers, site glow
export const ATK = '#e8862e';      // Breachers amber
export const DEF = '#2ea8a0';      // Wardens teal
export const SUN = '#ffb36b';      // warm low sun (key light)
export const SKY = '#33405a';      // dusk sky (hemisphere)
export const GROUND = '#22252a';   // asphalt yard floor
export const CONCRETE = '#454d57'; // poured walls, dividers
export const WOOD = '#7a5a38';     // crate timber
export const STEEL = '#6a7683';    // silos, containers

// Object form for code that reads PALETTE.<name> (shell / CSS mirror).
export const PALETTE = {
  canvas: CANVAS, surface: SURFACE, hairline: HAIRLINE,
  ink: INK, muted: MUTED, accent: ACCENT,
};
