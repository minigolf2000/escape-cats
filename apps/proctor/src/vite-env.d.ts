/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  /** What the proctor's QR code encodes. Optional: it defaults to this page's
   * own origin root, which is right in production. See App.tsx. */
  readonly VITE_LOBBY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
