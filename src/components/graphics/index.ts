/**
 * Graphics library (Design DNA v2). Real graphics that communicate structure, activity and progress — never decoration
 * for its own sake. Client components unless noted.
 *   AiCoreStage       procedural Three.js intelligence core (dynamic, client-only, SVG + reduced-motion fallbacks)
 *   CompanyUniverse   interactive network of departments, AI employees, products, customers, revenue (real data)
 *   NetworkGraph      the force-layout engine behind CompanyUniverse / knowledge constellations / provider maps
 *   DataFlow          canvas particles flowing between systems at real activity rates
 *   ParticleField     ambient canvas texture
 *   GrowthChart       animated area chart for a real metric series
 *   WorldIllustration one hand-drawn SVG scene per module world (server-safe)
 *   AiAvatar          deterministic, role-specific AI employee avatars (server-safe)
 */
export { AiCoreStage } from "./ai-core-stage";
export { CompanyUniverse, type UniverseGroup } from "./company-universe";
export { NetworkGraph, type GraphGroup, type GraphLink, type GraphNode, type GraphTone } from "./network-graph";
export { DataFlow, type FlowLink, type FlowNode } from "./data-flow";
export { ParticleField } from "./particle-field";
export { GrowthChart, type SeriesDatum } from "./growth-chart";
export * from "./illustrations";
export { AiAvatar, avatarFamily, avatarPalette, type AvatarFamily } from "./ai-avatar";
