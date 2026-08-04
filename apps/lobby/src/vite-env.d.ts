/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_HEX_URL?: string;
  readonly VITE_GOOMBA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
