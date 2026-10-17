/**
 * Bind the API port. This is the startup step that can fail with EADDRINUSE.
 * It must not create or update platform admins. The first admin is
 * `pnpm db:bootstrap-admin`, which is not part of process startup.
 * An omitted host calls listen with the port only. A port is not a loopback bind.
 */
export async function listenApi(
  listen: (port: number, host?: string) => Promise<unknown>,
  port: number,
  host?: string,
): Promise<void> {
  if (host === undefined) {
    await listen(port);
    return;
  }
  await listen(port, host);
}
