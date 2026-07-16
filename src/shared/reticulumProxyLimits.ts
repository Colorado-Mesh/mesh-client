/** Max JSON body size for Reticulum sidecar proxy POST/PUT from renderer IPC. */
export const RETICULUM_PROXY_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Max config file read size returned to renderer via IPC. */
export const RETICULUM_CONFIG_MAX_READ_BYTES = 2 * 1024 * 1024;

/**
 * Max response body size accepted from the local sidecar HTTP proxy
 * (GET/POST/PUT/DELETE). The sidecar is loopback-only, but a bug or a local
 * attacker on 127.0.0.1 sending a multi-MB response should not spike
 * main-process memory or fan out a huge IPC payload to the renderer.
 */
export const RETICULUM_PROXY_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Max single WebSocket frame accepted from the sidecar event stream. */
export const RETICULUM_WS_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
