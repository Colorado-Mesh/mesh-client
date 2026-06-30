import { lazy } from 'react';

export const AdminPanel = lazy(() => import('./components/AdminPanel'));
export const AppPanel = lazy(() => import('./components/AppPanel'));
export const TakServerPanel = lazy(() => import('./components/TakServerPanel'));
export const DiagnosticsPanel = lazy(() => import('./components/DiagnosticsPanel'));
export const MapPanel = lazy(() => import('./components/MapPanel'));
export const ModulePanel = lazy(() => import('./components/ModulePanel'));
export const RadioPanel = lazy(() => import('./components/RadioPanel'));
export const ReticulumRadioPanel = lazy(() => import('./components/ReticulumRadioPanel'));
export const NomadNetworkPanel = lazy(() => import('./components/NomadNetworkPanel'));
export const ReticulumPeerListPanel = lazy(() => import('./components/ReticulumPeerListPanel'));
export const RepeatersPanel = lazy(() => import('./components/RepeatersPanel'));
export const RoomsPanel = lazy(() => import('./components/RoomsPanel'));
export const SecurityPanel = lazy(() => import('./components/SecurityPanel'));
export const TelemetryPanel = lazy(() => import('./components/TelemetryPanel'));
export const PacketDistributionPanel = lazy(() => import('./components/PacketDistributionPanel'));
/** Sniffer tab in the UI (keyboard help: Packet Sniffer). */
export const RawPacketLogPanel = lazy(() => import('./components/RawPacketLogPanel'));
export const RFHistogramsPanel = lazy(() => import('./components/RFHistogramsPanel'));
export const PeerGraphPanel = lazy(() => import('./components/PeerGraphPanel'));
export const ReticulumTopologyPanel = lazy(() => import('./components/ReticulumTopologyPanel'));
