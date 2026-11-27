// A mod pane (the Diff tab) has no folder: keep the space's last terminal location while it has focus.
export function resolveLocation({ space, focused, pane, previous }) {
  const spaceId = space?.id ?? null;
  if (pane?.mod) {
    if (previous?.space === spaceId) {
      return previous;
    }
    return { space: spaceId, cwd: space?.folder, on: space?.machine ?? null };
  }
  const remoteTerminal = focused?.pane === null && focused.terminal?.includes("/");
  const on = focused?.pane === null ? (remoteTerminal ? focused.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { space: spaceId, cwd: pane?.cwd || focused?.cwd || space?.folder, on };
}
