/*
 * mesh_reticulum.h: run the mesh-client Reticulum sidecar in-process (iOS).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * iOS apps cannot spawn processes, so the MeshProcess plugin runs the sidecar library on a
 * background thread instead of exec'ing `mesh-client-reticulum`. Everything Electron main relies
 * on is kept: the same argv (without the program name), the one-line JSON bootstrap on stdin,
 * log lines on the output pipes, the authenticated loopback HTTP API, and an exit status.
 *
 * Calling sequence for one MeshProcess.spawn:
 *   1. Create three pipes (stdin, stdout, stderr).
 *   2. id = mesh_reticulum_start(argvJson, envJson, stdinRead, stdoutWrite, stderrWrite).
 *      The library owns those three descriptors from this call on (also on error); close only
 *      your ends: stdinWrite, stdoutRead, stderrRead.
 *   3. Forward writeStdin to stdinWrite; closeStdin closes stdinWrite.
 *   4. Read stdoutRead / stderrRead until EOF and emit them as `stdout` / `stderr` events.
 *      Tracing goes to the stderr pipe; `validate-config --json` prints its JSON on stdout.
 *   5. On a background queue: code = mesh_reticulum_wait(id). After both pipes reach EOF, emit
 *      `exit`: {code, signal: null}, or {code: null, signal: "SIGTERM"} when code is
 *      MESH_RETICULUM_EXIT_STOPPED.
 *   6. kill (any signal) = mesh_reticulum_stop(id); also close stdinWrite. The instance cancels
 *      all its tasks, releases its port, closes its pipes, and wait() then returns.
 *
 * Several instances may run at once (Electron main runs `validate-config` next to the stack).
 * All functions are thread-safe. Nothing is written to the app's own stdout/stderr, except the
 * Rust panic message if the sidecar panics.
 *
 * SIGPIPE: the app keeps the default (terminate) disposition. The library sets F_SETNOSIGPIPE on
 * the stdout/stderr write ends it receives; the plugin must do the same on its stdin write end
 * (fcntl(stdinWrite, F_SETNOSIGPIPE, 1)), because the library closes the stdin read end after the
 * bootstrap line (or at once on --help / argument errors) and a late writeStdin would otherwise
 * raise SIGPIPE in the app.
 */
#ifndef MESH_RETICULUM_H
#define MESH_RETICULUM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* mesh_reticulum_start: argv/env JSON or a descriptor was invalid. */
#define MESH_RETICULUM_ERR_INVALID_ARGUMENT (-1)
/* mesh_reticulum_start: the sidecar thread could not be created. */
#define MESH_RETICULUM_ERR_START_FAILED (-2)
/* mesh_reticulum_stop / mesh_reticulum_wait: unknown instance (or already waited). */
#define MESH_RETICULUM_ERR_UNKNOWN_INSTANCE (-1)
/* mesh_reticulum_wait: the instance ended because mesh_reticulum_stop was called. */
#define MESH_RETICULUM_EXIT_STOPPED (-15)
/* mesh_reticulum_wait: the sidecar panicked or its runtime could not be created. */
#define MESH_RETICULUM_EXIT_PANICKED (101)

/*
 * Start one sidecar instance on a new background thread and return immediately.
 *
 * argv_json: UTF-8 JSON array of strings, the MeshProcess `args` (no program name), e.g.
 *            ["--headless","--host","127.0.0.1","--port","50123", ...].
 * env_json:  NULL or a UTF-8 JSON object of strings, the MeshProcess `env`. Only RUST_LOG is
 *            used (the tracing filter, default "info"); the app's environment is not modified.
 * stdin_fd:  read end of the stdin pipe.
 * stdout_fd, stderr_fd: write ends of the output pipes.
 *
 * Returns a positive instance id, or a negative MESH_RETICULUM_ERR_* value.
 */
int64_t mesh_reticulum_start(const char *argv_json,
                             const char *env_json,
                             int stdin_fd,
                             int stdout_fd,
                             int stderr_fd);

/*
 * Ask an instance to stop. Non-blocking; a no-op if it has already exited.
 * Returns 0, or MESH_RETICULUM_ERR_UNKNOWN_INSTANCE.
 */
int32_t mesh_reticulum_stop(int64_t instance);

/*
 * Block until the instance exits, then release it. Call exactly once per started instance and
 * never on the main thread. Returns the exit status (0-255), MESH_RETICULUM_EXIT_STOPPED,
 * MESH_RETICULUM_EXIT_PANICKED, or MESH_RETICULUM_ERR_UNKNOWN_INSTANCE.
 */
int32_t mesh_reticulum_wait(int64_t instance);

#ifdef __cplusplus
}
#endif

#endif /* MESH_RETICULUM_H */
