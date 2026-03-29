import { lazy } from 'react';

export const AppPanel = lazy(() => import('./components/AppPanel'));
export const TakServerPanel = lazy(() => import('./components/TakServerPanel'));
export const DiagnosticsPanel = lazy(() => import('./components/DiagnosticsPanel'));
export const MapPanel = lazy(() => import('./components/MapPanel'));
export const ModulePanel = lazy(() => import('./components/ModulePanel'));
export const RadioPanel = lazy(() => import('./components/RadioPanel'));
export const RepeatersPanel = lazy(() => import('./components/RepeatersPanel'));
export const SecurityPanel = lazy(() => import('./components/SecurityPanel'));
export const TelemetryPanel = lazy(() => import('./components/TelemetryPanel'));
