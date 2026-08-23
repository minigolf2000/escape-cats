/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  /** Where the game lives, for the ad-hoc room links this page hands out.
   * Unset in production on purpose — see GOOMBA_URL in AdhocRooms.tsx. */
  readonly VITE_GOOMBA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
