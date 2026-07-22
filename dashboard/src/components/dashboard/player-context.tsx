"use client";

import * as React from "react";

type PlayerContextValue = {
  playerId: number;
  setPlayerId: (id: number) => void;
};

const PlayerContext = React.createContext<PlayerContextValue>({
  playerId: 1,
  setPlayerId: () => {},
});

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setPlayerId] = React.useState(1);
  const value = React.useMemo(() => ({ playerId, setPlayerId }), [playerId]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayerId() {
  return React.useContext(PlayerContext);
}
