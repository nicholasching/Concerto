import type { LocationData } from "@orchestra/contracts";

export interface SelectionPoint { x: number; y: number }
export interface DeviceSelection { mapRevision: number; deviceIds: number[] }
// Team 4 implements geometry behind this boundary.
export type SelectDevices = (locations: LocationData[], polygon: SelectionPoint[], mapRevision: number) => DeviceSelection;
