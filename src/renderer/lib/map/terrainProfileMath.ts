/** Re-export shared terrain / Fresnel math for renderer imports. */
export {
  computeTerrainClearance,
  earthBulgeM,
  fresnelRadiusM,
  interpolateLatLon,
  losHeightM,
  sampleGreatCirclePoints,
  type TerrainClearanceSample,
  type TerrainClearanceStatus,
  type TerrainClearanceSummary,
  type TerrainFrequencyMhz,
  type TerrainSamplePoint,
  wavelengthM,
} from '@/shared/elevation/profileMath';
