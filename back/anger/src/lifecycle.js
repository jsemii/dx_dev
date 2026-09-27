export async function closeAngerResources(
  server,
  pool,
  { timeoutMs = 2_000, setTimer = setTimeout, clearTimer = clearTimeout,
    playbackGateway, webSocketServer } = {},
) {
  playbackGateway?.close();
  webSocketServer?.close();
  await new Promise((resolve, reject) => {
    const timeoutId = setTimer(() => server.closeAllConnections?.(), timeoutMs);
    timeoutId?.unref?.();
    server.close((error) => {
      clearTimer(timeoutId);
      if (error) reject(error);
      else resolve();
    });
  });
  await pool.end();
}
