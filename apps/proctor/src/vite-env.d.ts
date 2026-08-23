/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  /** Where the games live, for the ad-hoc room links this page hands out.
   * Both unset in production on purpose — see GAMES in AdhocRooms.tsx. */
  readonly VITE_GOOMBA_URL?: string;
  readonly VITE_HEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
