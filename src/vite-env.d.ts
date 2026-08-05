/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
	readonly VITE_AUTH_SERVICE_URL?: string;
	readonly VITE_GOOGLE_CLIENT_ID?: string;
	readonly VITE_MICROSOFT_CLIENT_ID?: string;
}
