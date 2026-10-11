/**
 * Bind the API port. This is the startup step that can fail with EADDRINUSE.
 * It must not create or update platform admins. Explicit credential upsert is
 * `pnpm db:bootstrap-admin`, which is not part of process startup.
 */
export async function listenApi(
  listen: (port: number) => Promise<void>,
  port: number,
): Promise<void> {
  await listen(port);
}
